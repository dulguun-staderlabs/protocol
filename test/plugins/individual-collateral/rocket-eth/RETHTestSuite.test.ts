import collateralTests from '../collateralTests'
import {
  CollateralFixtureContext,
  CollateralOpts,
  MintCollateralFunc,
} from '../types'
import { resetFork, mintRETH } from './helpers'
import { ethers } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  ICollateral,
  IReth,
  WETH9
} from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  RETH,
  ETH_USD_PRICE_FEED
} from './constants'

/*
  Define interfaces
*/

interface RethCollateralFixtureContext extends CollateralFixtureContext {
    weth: WETH9
    reth: IReth
}

/*
  Define deployment functions
*/

export const defaultRethCollateralOpts: CollateralOpts = {
  erc20: RETH,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: WETH,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<ICollateral> => {
  opts = { ...defaultRethCollateralOpts, ...opts }

  const RethCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'RethCollateral'
  )
  
  const collateral = <ICollateral>await RethCollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    0,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  return collateral
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<RethCollateralFixtureContext> => {
  const collateralOpts = { ...defaultRethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, bn('1e18'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
    const reth = (await ethers.getContractAt('IReth', RETH)) as IReth
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tokDecimals = await reth.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      reth,
      tok: reth,
      rewardToken,
      tokDecimals,
    }
  }

  return makeCollateralFixtureContext
}

// const deployCollateralCometMockContext = async (
//   opts: CometCollateralOpts = {}
// ): Promise<RethCollateralFixtureContextMockComet> => {
//   const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

//   const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
//     await ethers.getContractFactory('MockV3Aggregator')
//   )
//   const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
//   collateralOpts.chainlinkFeed = chainlinkFeed.address

//   const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
//   const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

//   const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
//     await ethers.getContractFactory('CusdcV3Wrapper')
//   )
//   const wcusdcV3 = <ICusdcV3Wrapper>(
//     await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
//   )
//   const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
//     await ethers.getContractFactory('CusdcV3WrapperMock')
//   )
//   const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
//     await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
//   ))

//   const realMock = (await ethers.getContractAt(
//     'ICusdcV3WrapperMock',
//     wcusdcV3Mock.address
//   )) as ICusdcV3WrapperMock
//   collateralOpts.erc20 = wcusdcV3.address
//   collateralOpts.erc20 = realMock.address
//   const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
//   const collateral = await deployCollateral(collateralOpts)

//   const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
//   const tokDecimals = await wcusdcV3.decimals()

//   return {
//     collateral,
//     chainlinkFeed,
//     cusdcV3,
//     wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
//     wcusdcV3Mock,
//     usdc,
//     tok: wcusdcV3,
//     rewardToken,
//     tokDecimals,
//   }
// }

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<RethCollateralFixtureContext> = async (
  ctx: RethCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintRETH(ctx.weth, ctx.reth, user, amount, recipient)
}

const reduceRefPerTok = async (ctx: RethCollateralFixtureContext) => {
    
}


/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {

}

const collateralSpecificStatusTests = () => {

}

const beforeEachRewardsTest = async (ctx: RethCollateralFixtureContext) => {
  
}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  beforeEachRewardsTest,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceRefPerTok,
  itClaimsRewards: it,
  resetFork,
  collateralName: 'RocketPoolETH',
}

collateralTests(opts)
