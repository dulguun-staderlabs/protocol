import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp } from '../../common/numbers'

import * as sc from '../../typechain' // All smart contract types

import { addr } from './common'

const user = (i: number) => addr((i + 1) * 0x10000)
const ConAt = ethers.getContractAt
const F = ethers.getContractFactory
const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6

// { gasLimit: 0x1ffffffff }

const componentsOfP0 = async (main: sc.IMainFuzz) => ({
  rsr: await ConAt('ERC20Fuzz', await main.rsr()),
  rToken: await ConAt('RTokenP0Fuzz', await main.rToken()),
  stRSR: await ConAt('StRSRP0Fuzz', await main.stRSR()),
  assetRegistry: await ConAt('AssetRegistryP0Fuzz', await main.assetRegistry()),
  basketHandler: await ConAt('BasketHandlerP0Fuzz', await main.basketHandler()),
  backingManager: await ConAt('BackingManagerP0Fuzz', await main.backingManager()),
  distributor: await ConAt('DistributorP0Fuzz', await main.distributor()),
  rsrTrader: await ConAt('RevenueTraderP0Fuzz', await main.rsrTrader()),
  rTokenTrader: await ConAt('RevenueTraderP0Fuzz', await main.rTokenTrader()),
  furnace: await ConAt('FurnaceP0Fuzz', await main.furnace()),
  broker: await ConAt('BrokerP0Fuzz', await main.broker()),
})
type ComponentsP0 = Awaited<ReturnType<typeof componentsOfP0>>

const componentsOfP1 = async (main: sc.IMainFuzz) => ({
  rsr: await ConAt('ERC20Fuzz', await main.rsr()),
  rToken: await ConAt('RTokenP1Fuzz', await main.rToken()),
  stRSR: await ConAt('StRSRP1Fuzz', await main.stRSR()),
  assetRegistry: await ConAt('AssetRegistryP1Fuzz', await main.assetRegistry()),
  basketHandler: await ConAt('BasketHandlerP1Fuzz', await main.basketHandler()),
  backingManager: await ConAt('BackingManagerP1Fuzz', await main.backingManager()),
  distributor: await ConAt('DistributorP1Fuzz', await main.distributor()),
  rsrTrader: await ConAt('RevenueTraderP1Fuzz', await main.rsrTrader()),
  rTokenTrader: await ConAt('RevenueTraderP1Fuzz', await main.rTokenTrader()),
  furnace: await ConAt('FurnaceP1Fuzz', await main.furnace()),
  broker: await ConAt('BrokerP1Fuzz', await main.broker()),
})
type ComponentsP1 = Awaited<ReturnType<typeof componentsOfP1>>

describe('The Differential Testing scenario', () => {
  let scenario: sc.DiffTestScenario

  let p0: sc.MainP0Fuzz
  let comp0: ComponentsP0
  let p1: sc.MainP1Fuzz
  let comp1: ComponentsP1

  let startState: Awaited<ReturnType<typeof helpers.takeSnapshot>>

  let _owner: Wallet
  let alice: Signer
  let _bob: Signer
  let _carol: Signer

  let aliceAddr: string
  let _bobAddr: string
  let _carolAddr: string

  before('deploy and setup', async () => {
    ;[_owner] = (await ethers.getSigners()) as unknown as Wallet[]
    scenario = await (await F('DiffTestScenario')).deploy({ gasLimit: 0x1ffffffff })

    p0 = await ConAt('MainP0Fuzz', await scenario.p(0))
    comp0 = await componentsOfP0(p0)

    p1 = await ConAt('MainP1Fuzz', await scenario.p(1))
    comp1 = await componentsOfP1(p1)

    aliceAddr = user(0)
    _bobAddr = user(1)
    _carolAddr = user(2)

    alice = await ethers.getSigner(aliceAddr)
    _bob = await ethers.getSigner(_bobAddr)
    _carol = await ethers.getSigner(_carolAddr)

    await helpers.setBalance(aliceAddr, exa * exa)
    await helpers.setBalance(_bobAddr, exa * exa)
    await helpers.setBalance(_carolAddr, exa * exa)
    await helpers.setBalance(p0.address, exa * exa)
    await helpers.setBalance(p1.address, exa * exa)

    await helpers.impersonateAccount(aliceAddr)
    await helpers.impersonateAccount(_bobAddr)
    await helpers.impersonateAccount(_carolAddr)
    await helpers.impersonateAccount(p0.address)
    await helpers.impersonateAccount(p1.address)

    startState = await helpers.takeSnapshot()
  })

  after('stop impersonations', async () => {
    await helpers.stopImpersonatingAccount(aliceAddr)
    await helpers.stopImpersonatingAccount(_bobAddr)
    await helpers.stopImpersonatingAccount(_carolAddr)
    await helpers.stopImpersonatingAccount(p0.address)
    await helpers.stopImpersonatingAccount(p1.address)
  })

  beforeEach(async () => {
    await startState.restore()
  })

  it('deploys as expected', async () => {
    for (const main of [p0, p1]) {
      // users
      expect(await main.numUsers()).to.equal(3)
      expect(await main.users(0)).to.equal(user(0))
      expect(await main.users(1)).to.equal(user(1))
      expect(await main.users(2)).to.equal(user(2))

      // auth state
      expect(await main.frozen()).to.equal(false)
      expect(await main.pausedOrFrozen()).to.equal(false)

      // tokens and user balances
      const syms = ['C0', 'C1', 'C2', 'R0', 'R1', 'USD0', 'USD1', 'USD2']
      expect(await main.numTokens()).to.equal(syms.length)
      for (const sym of syms) {
        const tokenAddr = await main.tokenBySymbol(sym)
        const token = await ConAt('ERC20Fuzz', tokenAddr)
        expect(await token.symbol()).to.equal(sym)
        for (let u = 0; u < 3; u++) {
          expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
        }
      }
    }
  })

  describe('mutators', () => {
    it('issuance and redemption', async () => {
      await scenario.connect(alice).issue(5n * exa)
      expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)
      expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)

      await scenario.connect(alice).redeem(2n * exa)
      expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)
      expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)

      await expect(scenario.connect(alice).redeem(6n * exa)).to.be.reverted
    })
  })
})
