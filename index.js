const express = require('express');
const cors = require('cors');
const ethers = require("ethers");
const secrets = require("./secrets.json");
const ERC677_ABI = require("./ABI/ERC677_ABI.json");

const { MongoClient } = require('mongodb');

const app = express();
const port = 3000;

const mnemonic = secrets.mnemonic;

const networkUrlEthereum = "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161";
const networkUrlHuobi = "https://http-mainnet-node.huobichain.com"; //  "https://api.elastos.io/eth";
const networkUrlElastos = "https://api.elastos.io/eth";

const interfaceERC677_ABI = new ethers.utils.Interface(ERC677_ABI);

// Connection URL
const mongoUrl = "mongodb://localhost:27017";
const mongoClient = new MongoClient(mongoUrl);
// Database Name
const dbName = "bridge-faucet";
// Colletion name
const collectionName = "addresses";

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
    const requestBody = req.body;

    mongoClient.connect();
    //console.log('Connected successfully to server');
    
    const mongoDb = mongoClient.db(dbName);
    const mongoCollection = mongoDb.collection(collectionName);

    // find is this address use faucet
    const mongoCollectionFind = await mongoCollection.findOne( { address: { $eq: requestBody.address } } );
    //console.log(mongoCollectionFind);
    if (mongoCollectionFind == null) {
        var result = {
            "has_use_faucet": false
        };
    } else {
        var result = {
            "has_use_faucet": true
        };
    }

    res.json(result);
});

/* format for body
{
    txID: "0x0af252de1e65ad697e4a86c75b68b8dfc9b17d8f646fd39e28e6d132e367b2e6",
    chainID: 120, // 1 - eth, 120 - huobi
    address: "0x..123"
}
*/
app.post('/faucet', async function(req, res) {
    const requestBody = req.body;

    // find networkURL from which is transfer start 
    var networkUrlSender;
    if (requestBody && requestBody.chainID) {
        if (requestBody.chainID == 1) {
            networkUrlSender = networkUrlEthereum;
        } else if (requestBody.chainID == 120) {
            networkUrlSender = networkUrlHuobi;
        } else {
            res.status(400);
            res.send("This chainID is not allowed for send from faucet");
            return;
        }
    } else {
        res.status(400);
        res.send("ChainID is not set correct");
        return;
    }

    // get sender http provider
    const senderHttpProvider = new ethers.providers.JsonRpcProvider(networkUrlSender);

    // get transaction input
    const transactionInput = await senderHttpProvider.getTransaction(requestBody.txID);
    if (transactionInput == null) {
        res.status(400);
        res.send("Cannot find transaction with send txID");
        return;
    }
    //console.log(transactionInput);

    // check confirmations number
    if (transactionInput.confirmations >= 500) {
        res.status(400);
        res.send("There is more then 500 confirmations on this transaction");
        return;
    }

    // get input data for transaction
    const decodedInputData = interfaceERC677_ABI.parseTransaction({ data: transactionInput.data, value: transactionInput.value});
    if (decodedInputData == null) {
        res.status(400);
        res.send("Cannot decode with send txID");
        return;
    }

    // check is correct function name
    const functionName = decodedInputData.name;
    if (functionName != "transferAndCall") {
        res.status(400).end();
        res.send("txID is not good - function name isn't transferAndCall");
        return;
    }

    // Use connect method to connect to the server
    mongoClient.connect();
    //console.log('Connected successfully to server');
    
    const mongoDb = mongoClient.db(dbName);
    const mongoCollection = mongoDb.collection(collectionName);

    // find is this address use faucet
    const mongoCollectionFind = await mongoCollection.findOne( { address: { $eq: transactionInput.from } } );
    //console.log(mongoCollectionFind);
    if (mongoCollectionFind != null) {
        res.status(400);
        res.send("This address already received amount from faucet");
        return;
    }

    // insert new address
    const newAddressForInsert = {
        "address": transactionInput.from,
        "blockNumber": transactionInput.blockNumber,
    };
    await mongoCollection.insertOne(newAddressForInsert);

    
    /*console.log({
        function_name: decodedInput.name,
        from: transactionInput.from,
        to: decodedInput.args[0],
        erc20Value: Number(decodedInput.args[1])
    });*/  

    // get elastos http provider
    const elastosHttpProvider = new ethers.providers.JsonRpcProvider(networkUrlElastos);
    const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic).connect(elastosHttpProvider);
    const sendAccount = mnemonicWallet.getAddress();
    
    // prepare transaction
    const tx = {
        from: sendAccount,
        to: requestBody.address,
        value: ethers.utils.parseEther('0.01'),
        nonce: elastosHttpProvider.getTransactionCount(sendAccount, "latest"),
        gasLimit: ethers.utils.hexlify(100000), // 100000
    };
    
    // send transaction
    const transactionForSend = await mnemonicWallet.sendTransaction(tx);

    //console.log(transactionForSend);

    res.send('Ela is successful send');
});


app.listen(port, () => console.log(`Glide bridge faucet app listening on port ${port}!`));