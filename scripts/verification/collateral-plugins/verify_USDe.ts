import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../test/plugins/individual-collateral/ethena/constants'

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

  /********  Verify sUSDe COllateral  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.sUSDe,
    [
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDe,
        oracleError: ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.sUSDe,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: bn(0),
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      bn(0),
    ],
    'contracts/plugins/assets/ethena/USDeSelfReferentialCollateral.sol:USDeSelfReferentialCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
