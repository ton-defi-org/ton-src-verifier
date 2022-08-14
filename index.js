#! /usr/bin/env node
const { TonClient, Address, Cell } = require("ton");
const fs = require("fs/promises");
const { promisify } = require("util");
const { exec } = require("child_process");
const execAsync = promisify(exec);
const axios = require("axios");
const path = require("path");
const TEMP_DIR = "temp";

(async () => {
  try {
    // Read input JSON file
    const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));

    // Get on chain code cell hash
    const tonClient = new TonClient({
      endpoint: "https://toncenter.com/api/v2/jsonRPC",
    });

    const { code } = await tonClient.getContractState(Address.parse(config.address));
    const onchainCodeHash = Cell.fromBoc(code)[0].hash().toString("base64");

    // Download source files
    await fs.mkdir(TEMP_DIR);
    await Promise.all(
      config.files.map(async ([url, name]) => {
        const { data } = await axios.get(url);
        await fs.writeFile(path.join(TEMP_DIR, name), data);
      })
    );

    // Compile & retrieve hash (TODO support other func versions)
    await execAsync(config.compilationCommandLine, { cwd: TEMP_DIR });
    const fiftFile = path.join(TEMP_DIR, "temp.fift");
    const b64OutFile = `${fiftFile}-b64.cell`;
    const fiftCellSource = `"${fiftFile}" include \n
boc>B "${b64OutFile}" B>file`;
    const tmpB64Fift = path.join(TEMP_DIR, `temp.cell.fif`);
    await fs.writeFile(tmpB64Fift, fiftCellSource);
    await execAsync(`fift -s ${tmpB64Fift}`);
    const compiledHash = Cell.fromBoc(await fs.readFile(b64OutFile))[0]
      .hash()
      .toString("base64");

    // Compare hashes
    const outMsg = `Onchain hash:  ${onchainCodeHash}\nCompiled hash: ${compiledHash}`;
    if (compiledHash === onchainCodeHash) {
      console.log(`${outMsg}\n✅ Exact match`);
    } else {
      console.log(`${outMsg}\n❌ Hashes do not match`);
    }
  } finally {
    fs.rm(TEMP_DIR, { force: true, recursive: true });
  }
})();
