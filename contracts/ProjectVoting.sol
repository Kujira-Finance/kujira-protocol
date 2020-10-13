pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract ProjectVoting is Ownable, Initializable {
    
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 internal constant CONTRACT_FEE_1000 = 12; // to cover manual transaction costs
    uint256 internal constant MAX_DEPOSIT = 10 ether;

    bool public _isOpen = false;
    bool public _allowRefund = false;

    struct Project {
        address _address;
        uint256 _balance;
        string  _link;
    }
    EnumerableSet.AddressSet private _participants;
    mapping (address => uint256) private _balances;
    Project[] public _projects;
    uint256 public _estimatedTimestamp;

    IUniswapV2Router02 private uniswapRouter;

    /* Modifiers */

    modifier whenOpen {
        require(_isOpen, "The voting phase is not currently running");
        _;
    }

    /* Initializer */

    function initialize(address uniswapV2Router02) public initializer {
        uniswapRouter = IUniswapV2Router02(uniswapV2Router02);
    }

    /* Public */

    function deposit(uint8 index) payable external whenOpen {
        uint256 newBalance = _balances[msg.sender] + msg.value;
        require(newBalance <= MAX_DEPOSIT, "Deposit exceeds maximum limit");
        _balances[msg.sender] = newBalance;
        _projects[index]._balance = _projects[index]._balance.add(msg.value);
        _participants.add(msg.sender);
    }

    function reset(address[] calldata addresses, string[] calldata links, uint256 estimatedTimestamp) external onlyOwner {
        delete _projects;
        _isOpen = false;
        _allowRefund = false;
        _estimatedTimestamp = estimatedTimestamp;

        for (uint8 i = 0; i < addresses.length; ++i) {
            _projects.push(Project({ _address: addresses[i], _balance: 0, _link: links[i] }));
        }
        _isOpen = true;
    }

    function execute(uint256 deadline) external onlyOwner {
        _isOpen = false;

        // Select best project
        uint8 bestProjectIndex;
        for (uint8 i = 0; i < _projects.length; ++i) {
            if (_projects[i]._balance >= _projects[bestProjectIndex]._balance) {
                bestProjectIndex = i;
            }
        }

        // Keep original balance in memory
        uint256 balance = address(this).balance;

        // Transfer contract fee
        uint256 contractFee = balance.mul(CONTRACT_FEE_1000).div(uint256(1000));
        (bool success, ) = owner().call.value(contractFee)("");
        require(success, "Fee transfer failed");

        // Execute swap through Uniswap
        address tokenAddress = _projects[bestProjectIndex]._address;
        uint256 amount = address(this).balance;

        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = tokenAddress;
        uniswapRouter.swapExactETHForTokens.value(amount)(0, path, address(this), deadline);
        IERC20 token = IERC20(tokenAddress);

        uint256 amountBought = token.balanceOf(address(this));
        require(amountBought > 0, "Couldn't buy tokens");

        // Send proportional amount of tokens to each participant
        while (_participants.length() > 0) {
            address participant = _participants.at(0); // take first element
            uint256 tokenShare = amountBought.mul(_balances[participant]).div(balance);
            _participants.remove(participant); // removing from the set shifts the indices
            delete _balances[participant];
            require(token.transfer(participant, tokenShare), "Token transfer failed");
        }

    }

    /* Emergency refund mechanism */

    function allowRefund() external onlyOwner {
        _allowRefund = true;
        delete _projects;
    }

    function refundAll() external {
        for (uint256 i = 0; i < _participants.length(); ++i) {
            refund(_participants.at(i));
        }
    }

    function refund(address account) public {
        require(_allowRefund, "Emergency refund isn't enabled");
        uint256 balance = _balances[account];
        require(balance > 0, "Nothing to refund");
        _balances[account] = 0;
        _participants.remove(account);
        (bool success, ) = account.call.value(balance)("");
        require(success, "Refund failed");
    }

    /* Receive leftover ETH */

    receive() payable external {
        (bool success, ) = owner().call.value(msg.value)("");
        require(success, "Receive refund to owner failed");
    }

    /* Views */

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function projectsCount() external view returns (uint256) {
        return _projects.length;
    }

    function participantsCount() external view returns (uint256) {
        return _participants.length();
    }

}
