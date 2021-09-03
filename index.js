const express = require('express');
const cors = require('cors');
const ethers = require("ethers");
const secrets = require("./secrets.json");

const app = express();
const port = 3000;

const mnemonic = secrets.mnemonic;

const networkUrl = "http://localhost:8545"; // "https://api.elastos.io/eth";

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/* format for body
{
    address: 0x..123
}*/
app.get('/faucet/', async function(req, res) {
    const recipient = req.body;

    const customHttpProvider = new ethers.providers.JsonRpcProvider(networkUrl);

    // get balance
    const balance = await customHttpProvider.getBalance(recipient.address);

    const result = {
        "address": recipient.address,
        "balance": balance.toString()
    };

    res.json(result);
});

/* format for body
{
    address: 0x..123
}
*/
app.post('/faucet', async function(req, res) {
    const recipient = req.body;

    const customHttpProvider = new ethers.providers.JsonRpcProvider(networkUrl);
    const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic).connect(customHttpProvider);
    const sendAccount = mnemonicWallet.getAddress();

    // prepare transaction
    const tx = {
        from: sendAccount,
        to: recipient.address,
        value: ethers.utils.parseEther('0.01'),
        nonce: customHttpProvider.getTransactionCount(sendAccount, "latest"),
        gasLimit: ethers.utils.hexlify(100000), // 100000
    };

    // send transaction
    const transaction = await mnemonicWallet.sendTransaction(tx);

    console.log(transaction);

    res.send('Ela is successful send');
});


app.listen(port, () => console.log(`Glide bridge faucet app listening on port ${port}!`));