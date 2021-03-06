const express = require('express');
const cors = require('cors');
const ethers = require("ethers");
const secrets = require("./secrets.json");
const ERC677_ABI = require("./ABI/ERC677_ABI.json");
const AMB_NATIVE_ERC_ABI = require("./ABI/AMB_NATIVE_ERC_ABI.json");

const { MongoClient } = require('mongodb');

const app = express();
const port = 3001;

const mnemonic = secrets.mnemonic;

const networkUrlEthereum = "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161";
const networkUrlHuobi = "https://http-mainnet-node.huobichain.com"; 
const networkUrlElastos = "https://api.elastos.io/eth"; // https://esc.elaphant.app

const interfaceERC677_ABI = new ethers.utils.Interface(ERC677_ABI);
const interfaceAMB_NATIVE_ERC_ABI = new ethers.utils.Interface(AMB_NATIVE_ERC_ABI);

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
app.get('/faucet/:address', async function(req, res) {
    const requestParams = req.params;
    mongoClient.connect();
    //console.log('Connected successfully to server');
    
    const mongoDb = mongoClient.db(dbName);
    const mongoCollection = mongoDb.collection(collectionName);

    // find is this address use faucet
    const mongoCollectionFind = await mongoCollection.findOne( { address: { $eq: requestParams.address } } );
    //console.log(mongoCollectionFind);
    if (mongoCollectionFind == null) {
        var result = {
            "has_use_faucet": false
        };
    } else {
        const currentTime = Date.now();
        // it passed one day, can be used
        if (currentTime > mongoCollectionFind.timeUsed + 86400000) {
            var result = {
                "has_use_faucet": false
            };
        } else {
            var result = {
                "has_use_faucet": true // testing
            };
        }
    }

    res.json(result);
});

/* format for body
{
    txID: "0x0af252de1e65ad697e4a86c75b68b8dfc9b17d8f646fd39e28e6d132e367b2e6",
    chainID: 128, // 1 - eth, 128 - huobi
    address: "0x..123",
    type: 'relayTokens' or 'transferAndCall'
}
*/

app.post('/faucet', async function(req, res) {
    const requestBody = req.body;
    console.log(requestBody)
    // find networkURL from which is transfer start 
    var networkUrlSender;
    if (requestBody && requestBody.chainID) {
        if (requestBody.chainID == 1) {
            networkUrlSender = networkUrlEthereum;
        } else if (requestBody.chainID == 128) {
            networkUrlSender = networkUrlHuobi;
        } else {
            res.status(400);
            res.send(JSON.stringify({
                error: {
                    code: 1,
                    message: "This chainID is not allowed for send from faucet"
                }
            }));
            return;
        }
    } else {
        res.status(400);
        res.send(JSON.stringify({
            error: {
                code: 2,
                message: "ChainID is not set correct"
            }
        }));
        return;
    }

    // get sender http provider
    const senderHttpProvider = new ethers.providers.JsonRpcProvider(networkUrlSender);

    // get transaction input
    const transactionInput = await senderHttpProvider.getTransaction(requestBody.txID);
    if (transactionInput == null) {
        res.status(400);
        res.send(JSON.stringify({
            error: {
                code: 3,
                message: "Cannot find transaction with send txID"
            }
        }));
        return;
    }
    //console.log(transactionInput);

    // check confirmations number
    if (transactionInput.confirmations >= 500) {
        res.status(400);
        res.send(JSON.stringify({
            error: {
                code: 4,
                message: "There is more then 500 confirmations on this transaction"
            }
        }));
        return;
    }

    // get input data for transaction
    let decodedInputData;
    let functionDecodedName = requestBody.type;
    if (functionDecodedName === "transferAndCall") {
        decodedInputData = interfaceERC677_ABI.parseTransaction({ data: transactionInput.data, value: transactionInput.value});
    } else {
        decodedInputData = interfaceAMB_NATIVE_ERC_ABI.parseTransaction({ data: transactionInput.data, value: transactionInput.value});
    }

    if (decodedInputData == null) {
        res.status(400);
        res.send(JSON.stringify({
            error: {
                code: 5,
                message: "Cannot decode with send txID"
            }
        }));
        return;
    }

    // check is correct function name
    const functionName = decodedInputData.name;
    if (functionName != functionDecodedName) {
        res.status(400).end();
        res.send(JSON.stringify({
            error: {
                code: 6,
                message: "txID is not good - function name isn't " + functionDecodedName
            }
        }));
        return;
    }

    // Use connect method to connect to the server
    mongoClient.connect();
    //console.log('Connected successfully to server');
    
    const mongoDb = mongoClient.db(dbName);
    const mongoCollection = mongoDb.collection(collectionName);

    // find is this address use faucet
    const mongoCollectionFind = await mongoCollection.findOne( { address: { $eq: transactionInput.from } } );
    const currentTime = Date.now();
    //console.log(mongoCollectionFind);
    if (mongoCollectionFind != null) {
        // it not passed one day, cannot be used
        if (currentTime <= mongoCollectionFind.timeUsed + 86400000) {
            res.status(400);
            res.send(JSON.stringify({
                error: {
                    code: 7,
                    message: "This address already received amount from faucet"
                }
            }));
            return;
        } else {
            await mongoCollection.updateOne(
                { _id: mongoCollectionFind._id },
                { $set: { timeUsed: currentTime }}
            );
        }
    }
    else {
        // insert new address
        const newAddressForInsert = {
            "address": transactionInput.from,
            "blockNumber": transactionInput.blockNumber,
            "timeUsed": currentTime
        };
        await mongoCollection.insertOne(newAddressForInsert);
    }

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
    await mnemonicWallet.sendTransaction(tx);

    res.send(JSON.stringify({
        success: {
            code: 1,
            message: "Ela from bridge faucet is successful send"
        }
    }));
});


app.listen(port, () => console.log(`Glide bridge faucet app listening on port ${port}!`));
