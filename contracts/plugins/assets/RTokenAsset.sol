// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../../p1/mixins/RecollateralizationLib.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/IRToken.sol";
import "./Asset.sol";

/// Once an RToken gets large enough to get a price feed, replacing this asset with
/// a simpler one will do wonders for gas usage
contract RTokenAsset is IAsset {
    using FixLib for uint192;

    // Component addresses are not mutable in protocol, so it's safe to cache these
    IBasketHandler public immutable basketHandler;
    IAssetRegistry public immutable assetRegistry;
    IBackingManager public immutable backingManager;

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(IRToken erc20_, uint192 maxTradeVolume_) {
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");

        IMain main = erc20_.main();
        basketHandler = main.basketHandler();
        assetRegistry = main.assetRegistry();
        backingManager = main.backingManager();

        erc20 = IERC20Metadata(address(erc20_));
        erc20Decimals = erc20_.decimals();
        maxTradeVolume = maxTradeVolume_;
    }

    /// Calculates price() & lotPrice() in a gas-optimized way using a cached BasketRange
    /// Used by RecollateralizationLib for efficient price calculation
    /// @param buRange {BU} The top and bottom of the bu band; how many BUs we expect to hold
    /// @param buPrice {UoA/BU} The low and high price estimate of a basket unit
    /// @param buLotPrice {UoA/BU} The low and high lotprice of a basket unit
    /// @return price_ {UoA/tok} The low and high price estimate of an RToken
    /// @return lotPrice_ {UoA/tok} The low and high lotprice of an RToken
    function prices(
        BasketRange memory buRange,
        Price memory buPrice,
        Price memory buLotPrice
    ) public view returns (Price memory price_, Price memory lotPrice_) {
        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (buPrice, buLotPrice);

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        price_.low = buRange.bottom.mulDiv(buPrice.low, supply, FLOOR);
        price_.high = buRange.top.mulDiv(buPrice.high, supply, CEIL);
        lotPrice_.low = buRange.bottom.mulDiv(buLotPrice.low, supply, FLOOR);
        lotPrice_.high = buRange.top.mulDiv(buLotPrice.high, supply, CEIL);
        assert(price_.low <= price_.high);
        assert(lotPrice_.low <= lotPrice_.high);
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    function tryPrice() external view virtual returns (uint192 low, uint192 high) {
        (uint192 lowBUPrice, uint192 highBUPrice) = basketHandler.price(); // {UoA/BU}
        assert(lowBUPrice <= highBUPrice); // not obviously true just by inspection

        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (lowBUPrice, highBUPrice);

        // The RToken's price is not symmetric like other assets!
        // range.bottom is lower because of the slippage from the shortfall
        BasketRange memory range = basketRange(); // {BU}

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        low = range.bottom.mulDiv(lowBUPrice, supply, FLOOR);
        high = range.top.mulDiv(highBUPrice, supply, CEIL);
        assert(low <= high); // not obviously true
    }

    // solhint-disable no-empty-blocks
    function refresh() public virtual override {
        // No need to save lastPrice; can piggyback off the backing collateral's lotPrice()
    }

    // solhint-enable no-empty-blocks

    /// Should not revert
    /// @return {UoA/tok} The lower end of the price estimate
    /// @return {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192, uint192) {
        try this.tryPrice() returns (uint192 low, uint192 high) {
            return (low, high);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return (0, FIX_MAX);
        }
    }

    /// Should not revert
    /// lotLow should be nonzero when the asset might be worth selling
    /// @return lotLow {UoA/tok} The lower end of the lot price estimate
    /// @return lotHigh {UoA/tok} The upper end of the lot price estimate
    function lotPrice() external view returns (uint192 lotLow, uint192 lotHigh) {
        (uint192 buLow, uint192 buHigh) = basketHandler.lotPrice(); // {UoA/BU}

        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (buLow, buHigh);

        BasketRange memory range = basketRange(); // {BU}

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        lotLow = range.bottom.mulDiv(buLow, supply, FLOOR);
        lotHigh = range.top.mulDiv(buHigh, supply, CEIL);
        assert(lotLow <= lotHigh); // not obviously true
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        // The RToken has 18 decimals, so there's no reason to waste gas here doing a shiftl_toFix
        // return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
        return _safeWrap(erc20.balanceOf(account));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks

    // ==== Private ====

    /// Computationally expensive basketRange calculation; used in price() & lotPrice()
    function basketRange() private view returns (BasketRange memory range) {
        Price memory buPrice;
        (buPrice.low, buPrice.high) = basketHandler.price(); // {UoA/BU}

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(backingManager));
        uint192 basketsNeeded = IRToken(address(erc20)).basketsNeeded(); // {BU}

        // if (basketHandler.fullyCollateralized())
        if (basketsHeld.bottom >= basketsNeeded) {
            range.bottom = basketsNeeded;
            range.top = basketsNeeded;
        } else {
            // Note: Extremely this is extremely wasteful in terms of gas. This only exists so
            // there is _some_ asset to represent the RToken itself when it is deployed, in
            // the absence of an external price feed. Any RToken that gets reasonably big
            // should switch over to an asset with a price feed.

            IMain main = backingManager.main();
            TradingContext memory ctx = TradingContext({
                basketsHeld: basketsHeld,
                bm: backingManager,
                ar: main.assetRegistry(),
                stRSR: main.stRSR(),
                rsr: main.rsr(),
                rToken: main.rToken(),
                minTradeVolume: backingManager.minTradeVolume(),
                maxTradeSlippage: backingManager.maxTradeSlippage()
            });

            Registry memory reg = assetRegistry.getRegistry();

            uint192[] memory quantities = new uint192[](reg.erc20s.length);
            for (uint256 i = 0; i < reg.erc20s.length; ++i) {
                quantities[i] = basketHandler.quantityUnsafe(reg.erc20s[i], reg.assets[i]);
            }

            // will exclude UoA value from RToken balances at BackingManager
            range = RecollateralizationLibP1.basketRange(ctx, reg, quantities, buPrice);
        }
    }
}
