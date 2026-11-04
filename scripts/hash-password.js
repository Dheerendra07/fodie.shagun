"use strict";
const readline = require("node:readline");
const { hashPassword } = require("../server/production");
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
terminal.question("Enter the admin password to hash (10+ characters): ", async password => {
  try {
    const value = await hashPassword(password);
    process.stdout.write("\nADMIN_PASSWORD_HASH=" + value + "\n");
  } catch (error) {
    process.stderr.write("\n" + error.message + "\n");
    process.exitCode = 1;
  } finally {
    terminal.close();
  }
});
