![banner](https://i.ibb.co/7zdqsWq/banner.png)

# Kujira Protocol

Kujira is a DeFi project aiming to regroup small holders and become a unified whale, investing into projects with small market caps and provide instant pumps.

In a matter of fairness, the process is decentralized through a smart contract, contained in this repository.

## Contract Flow

### 1. Set projects and open the vote

`reset(address[] addresses, string[] links, uint256 estimatedTimestamp)` (onlyOwner)

- Sets the projects to vote on.

- **addresses**: array of project addresses (will fetch name, symbol and decimals from the associated ERC20 token)
- **links**: array of project websites (for users to check external information)
- **estimatedTimestamp**: planned end of the voting phase

### 2. Vote for a project

`deposit(uint8 index)` (payable)

- Votes on the selected project with the associated amount of ETH paid to the function.

- **index**: project index starting from 0

### 3. Close the vote and execute the swap

`execute()` (onlyOwner)

- Selects the project with the most votes, executes the swap on Uniswap with the entire contract balance (minus contract fees), and redistributes the tokens back to all participants.

### Emergency refund mechanism

An emergency refund mechanism is built in the contract. It can only be triggered by the deployer of the contract, at which point all participants can call a function to get their deposit back.

`allowRefund()` (onlyOwner)

`refund(address account)`

### Contract Fees

The protocol is not fully decentralized yet in the sense that it requires manual execution of two functions by the contract deployer (`reset` and `execute`). A fully decentralized mechanism is being worked on; in the meantime, to provide sustainability and to reimburse the costs of calling the functions to the deployer, a contract fee of 1.2% is deducted from the total balance when the `execute` function is called. This contract fee goes back to the caller's address when the swap has been successfully executed and the tokens distributed.

*Note: in case of an emergency refund, no contract fees are deducted and all participants are refunded the exact amount of ETH they initially deposited.*

# Local Development

## Compiling

`yarn compile`

## Testing

`yarn test`

## Deploying

`yarn deploy`