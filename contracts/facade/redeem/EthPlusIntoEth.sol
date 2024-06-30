// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IBasketHandler } from "../../interfaces/IBasketHandler.sol";
import { IRToken } from "../../interfaces/IRToken.sol";
import { RoundingMode, FixLib } from "../../libraries/Fixed.sol";

interface IWETH is IERC20 {
    function withdraw(uint256 wad) external;
}

interface IRETHRouter {
    function swapTo(
        uint256 _uniswapPortion,
        uint256 _balancerPortion,
        uint256 _minTokensOut,
        uint256 _idealTokensOut
    ) external payable;

    function swapFrom(
        uint256 _uniswapPortion,
        uint256 _balancerPortion,
        uint256 _minTokensOut,
        uint256 _idealTokensOut,
        uint256 _tokensIn
    ) external;

    function optimiseSwapTo(uint256 _amount, uint256 _steps)
        external
        returns (uint256[2] memory portions, uint256 amountOut);

    function optimiseSwapFrom(uint256 _amount, uint256 _steps)
        external
        returns (uint256[2] memory portions, uint256 amountOut);
}

interface IWSTETH is IERC20 {
    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);
}

interface ICurveETHstETHStableSwap {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy
    ) external payable returns (uint256);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);
}

interface IRETH is IERC20 {
    function burn(uint256 rethAmt) external;

    function getEthValue(uint256 rethAmt) external view returns (uint256);
}

interface ICurveStableSwap {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy,
        address receiver
    ) external returns (uint256);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);
}

interface IUniswapV2Like {
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        // is ignored, can be empty
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(
        uint256 amountIn,
        // is ignored, can be empty
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}

/** Small utility contract to swap ETH+ for ETH by redeeming ETH+ and swapping.
 */
contract EthPlusIntoEth is IUniswapV2Like {
    using SafeERC20 for IERC20;

    IRToken private constant ETH_PLUS = IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8);

    IRETH private constant RETH = IRETH(0xae78736Cd615f374D3085123A210448E74Fc6393);

    IWETH private constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    IRETHRouter private constant RETH_ROUTER =
        IRETHRouter(0x16D5A408e807db8eF7c578279BEeEe6b228f1c1C);

    IWSTETH private constant WSTETH = IWSTETH(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0);
    IERC20 private constant STETH = IERC20(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84);

    IERC4626 private constant SFRXETH = IERC4626(0xac3E018457B222d93114458476f3E3416Abbe38F);
    IERC20 private constant FRXETH = IERC20(0x5E8422345238F34275888049021821E8E08CAa1f);
    ICurveETHstETHStableSwap private constant CURVE_ETHSTETH_STABLE_SWAP =
        ICurveETHstETHStableSwap(0xDC24316b9AE028F1497c275EB9192a3Ea0f67022);
    ICurveStableSwap private constant CURVE_FRXETH_WETH =
        ICurveStableSwap(0x9c3B46C0Ceb5B9e304FCd6D88Fc50f7DD24B31Bc);

    function getETHPlusRedemptionQuantities(uint256 amt) external returns (uint256[] memory) {
        IBasketHandler handler = ETH_PLUS.main().basketHandler();
        uint256 supply = ETH_PLUS.totalSupply();
        (, uint256[] memory quantities) = handler.quote(
            FixLib.muluDivu(ETH_PLUS.basketsNeeded(), amt, supply, RoundingMode.CEIL),
            RoundingMode.FLOOR
        );
        return quantities;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        require(amountIn != 0, "INVALID_AMOUNT_IN");
        amounts = new uint256[](2);
        amounts[0] = amountIn;

        IBasketHandler handler = ETH_PLUS.main().basketHandler();
        (, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("getETHPlusRedemptionQuantities(uint256)", amountIn)
        );
        uint256[] memory quantities = abi.decode(data, (uint256[]));

        {
            amounts[1] += RETH.getEthValue(quantities[2]);
        }

        {
            uint256 stEthAmt = WSTETH.getStETHByWstETH(quantities[1]);

            amounts[1] += CURVE_ETHSTETH_STABLE_SWAP.get_dy(1, 0, stEthAmt);
        }

        {
            uint256 frxEthAmt = SFRXETH.convertToAssets(quantities[0]);
            amounts[1] += CURVE_FRXETH_WETH.get_dy(1, 0, frxEthAmt);
        }

        return amounts;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        // is ignored so can be both empty, or token path, or anything
        // solhint-disable-next-line unused-ignore
        address[] calldata,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        // solhint-disable-next-line custom-errors
        require(deadline >= block.timestamp, "DEADLINE");
        require(to != address(0), "INVALID_TO");
        require(amountIn != 0, "INVALID_AMOUNT_IN");
        ETH_PLUS.transferFrom(msg.sender, address(this), amountIn);
        ETH_PLUS.redeem(ETH_PLUS.balanceOf(address(this)));

        // reth -> eth
        RETH.burn(RETH.balanceOf(address(this)));

        // wsteth -> eth
        {
            WSTETH.unwrap(WSTETH.balanceOf(address(this)));
            uint256 stethBalance = STETH.balanceOf(address(this));
            STETH.approve(address(CURVE_ETHSTETH_STABLE_SWAP), stethBalance);
            CURVE_ETHSTETH_STABLE_SWAP.exchange(1, 0, stethBalance, 0);
        }

        // sfrxeth -> eth
        {
            uint256 sfrxethBalance = SFRXETH.balanceOf(address(this));
            SFRXETH.redeem(sfrxethBalance, address(this), address(this));
            uint256 frxethBalance = FRXETH.balanceOf(address(this));
            FRXETH.approve(address(CURVE_FRXETH_WETH), frxethBalance);

            // frxeth -> weth
            CURVE_FRXETH_WETH.exchange(1, 0, frxethBalance, 0, address(this));

            // weth -> eth
            WETH.withdraw(WETH.balanceOf(address(this)));
        }
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = address(this).balance;

        // solhint-disable-next-line custom-errors
        require(address(this).balance >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        (bool success, ) = to.call{ value: address(this).balance }("");

        // solhint-disable-next-line custom-errors
        require(success, "ETH_TRANSFER_FAILED");
    }

    receive() external payable {}
}
