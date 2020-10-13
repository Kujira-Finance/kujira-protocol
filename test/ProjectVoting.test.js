const { accounts, contract } = require("@openzeppelin/test-environment")
const { expect } = require("chai")

const { BN, ether, expectRevert, time, balance } = require("@openzeppelin/test-helpers")

const ProjectVoting = contract.fromArtifact("ProjectVoting")

const ERC20 = contract.fromArtifact("@openzeppelin/contracts/ERC20PresetMinterPauser")

const wethArtifact = require("canonical-weth/build/contracts/WETH9.json")
const weth = contract.fromABI(wethArtifact.abi, wethArtifact.bytecode)

const uniswapFactoryArtifact = require("@uniswap/v2-core/build/UniswapV2Factory.json")
const UniswapV2Factory = contract.fromABI(uniswapFactoryArtifact.abi, uniswapFactoryArtifact.bytecode)
const uniswapRouterArtifact = require("@uniswap/v2-periphery/build/UniswapV2Router02.json")
const UniswapV2Router02 = contract.fromABI(uniswapRouterArtifact.abi, uniswapRouterArtifact.bytecode)

describe("ProjectVoting", function () {
    const [owner, user1, user2] = accounts

    beforeEach(async function () {
        this.deadline = (await time.latest()).add(time.duration.seconds(15))

        this.tokenContract = await ERC20.new("Test", "TEST")
        this.wETHContract = await weth.new()
        this.uniswapFactoryContract = await UniswapV2Factory.new(owner)
        this.uniswapRouterContract = await UniswapV2Router02.new(this.uniswapFactoryContract.address, this.wETHContract.address)
        await this.tokenContract.mint(owner, ether("1000"))
        await this.tokenContract.approve(this.uniswapRouterContract.address, -1, { from: owner })
        await this.uniswapRouterContract.addLiquidityETH(
            this.tokenContract.address, ether("100"), 0, 0, owner, this.deadline,
            { from: owner, value: ether("4") }
        )

        this.contract = await ProjectVoting.new({ from: owner })
        await this.contract.initialize(this.uniswapRouterContract.address)
    })

    it("sets the deployer as the owner", async function () {
        expect(await this.contract.owner()).to.equal(owner)
    })

    it("can't deposit before the voting phase has started", async function () {
        await expectRevert(
            this.contract.deposit(0, { from: user1, value: 1 }),
            "The voting phase is not currently running"
        )
    })

    describe("with projects", function () {

        beforeEach(async function () {
            // chosen project is index 1
            await this.contract.reset(["0x0000000000000000000000000000000000000000", this.tokenContract.address], ["https://link0.com", "https://link1.com"], 10, { from: owner })
        })

        it("is open", async function () {
            expect(await this.contract._isOpen()).to.equal(true)
        })

        it("is not refundable", async function () {
            expect(await this.contract._allowRefund()).to.equal(false)
        })

        it("sets projects correctly", async function () {
            expect(await this.contract.projectsCount()).to.be.bignumber.equal(new BN(2))
            const project1 = await this.contract._projects(1)
            expect(project1._address).to.equal(this.tokenContract.address)
            expect(project1._balance).to.be.bignumber.equal(new BN(0))
            expect(project1._link).to.be.equal("https://link1.com")
            expect(await this.contract._estimatedTimestamp()).to.be.bignumber.equal(new BN(10))
        })
    
        it("can deposit on a project", async function () {
            await this.contract.deposit(0, { from: user1, value: 1 })
            const project0 = await this.contract._projects(0)
            expect(project0._balance).to.be.bignumber.equal(new BN(1))
        })

        it("can deposit on multiple projects", async function () {
            await this.contract.deposit(0, { from: user1, value: 1 })
            await this.contract.deposit(1, { from: user1, value: 2 })
            const project0 = await this.contract._projects(0)
            const project1 = await this.contract._projects(1)
            expect(project0._balance).to.be.bignumber.equal(new BN(1))
            expect(project1._balance).to.be.bignumber.equal(new BN(2))
            expect(await this.contract.balanceOf(user1)).to.be.bignumber.equal(new BN(3))
        })

        it("can't deposit more than the maximum", async function () {
            await this.contract.deposit(0, { from: user1, value: ether("2") })
            await this.contract.deposit(1, { from: user1, value: ether("7") })
            await expectRevert(
                this.contract.deposit(0, { from: user1, value: ether("10") }),
                "Deposit exceeds maximum limit"
            )
        })

        it("has a balance of 0 before deposits", async function () {
            expect(await balance.current(this.contract.address, "ether")).to.be.bignumber.equal(new BN(0))
        })

        describe("with initial deposit on projects", function () {

            beforeEach(async function () {
                await this.contract.deposit(0, { from: user1, value: ether("2") })
                await this.contract.deposit(1, { from: user2, value: ether("4") })
            })

            describe("when refund mode is enabled", function () {

                beforeEach(async function () {
                    await this.contract.allowRefund({ from: owner })
                })

                it("enables refund mode correctly", async function () {
                    expect(await this.contract._allowRefund()).to.equal(true)
                })

                it("can't refund twice", async function () {
                    await this.contract.refund(user1)
                    await expectRevert(
                        this.contract.refund(user1),
                        "Nothing to refund"
                    )
                })

                it("refunds the right amount", async function () {
                    const tracker = await balance.tracker(user1, "ether")
                    await this.contract.refund(user1)
                    expect(await tracker.delta()).to.be.bignumber.equal("2")
                })

            })

            it("has the correct number of participants", async function () {
                expect(await this.contract.participantsCount()).to.be.bignumber.equal("2")
            })

            it("has the correct balance", async function () {
                expect(await balance.current(this.contract.address, "ether")).to.be.bignumber.equal("6")
            })

            it("has a token balance of 0", async function () {
                expect(await this.tokenContract.balanceOf(this.contract.address)).to.be.bignumber.equal(new BN(0))
                expect(await this.tokenContract.balanceOf(user1)).to.be.bignumber.equal(new BN(0))
                expect(await this.tokenContract.balanceOf(user2)).to.be.bignumber.equal(new BN(0))
            })

            describe("after swap execution", function () {

                beforeEach(async function () {
                    this.ownerBalanceTracker = await balance.tracker(owner)
                    await this.contract.execute(this.deadline, { from: owner })
                })

                it("distributes all tokens", async function () {
                    expect(await this.tokenContract.balanceOf(this.contract.address)).to.be.bignumber.lte(new BN(1))
                })

                it("spends all eth", async function () {
                    expect(await balance.current(this.contract.address)).to.be.bignumber.equal(new BN(0))
                })

                it("takes a platform fee", async function () {
                    expect(await this.ownerBalanceTracker.delta()).to.be.bignumber.above(new BN(0))
                })

                it("sends chosen token to participants", async function () {
                    expect(await this.tokenContract.balanceOf(user1)).to.be.bignumber.above(new BN(0))
                    expect(await this.tokenContract.balanceOf(user2)).to.be.bignumber.above(new BN(0))
                })

                it("removes all participants", async function () {
                    expect(await this.contract.participantsCount()).to.be.bignumber.equal(new BN(0))
                })

                /*it("chooses project with the most votes", async function () {
                    console.log(await this.tokenContract.balanceOf(owner))
                    console.log(await this.tokenContract.balanceOf(user1))
                })*/

            })

        })

    })

})
