import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import {
  priceTimeout,
  oracleTimeout,
  verifyContract,
} from '../../deployment/utils'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify Lido Wrapped-Staked-ETH - wstETH  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.wstETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%,
        erc20: networkConfig[chainId].tokens.wstETH,
        maxTradeVolume: fp('1e3').toString(), // 1k $ETH,
        oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.15').toString(), // 15%
        delayUntilDefault: bn('86400').toString() // 24h
      },
      bn('1e14'), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.stETH, // targetPerRefChainlinkFeed
      oracleTimeout(chainId, '3600').toString() // targetPerRefChainlinkTimeout
    ],
    'contracts/plugins/lido/LidoStakedEthCollateral.sol:LidoStakedEthCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
