"use strict";

/**
 * Account creation and funding.
 *
 * A paper account exists to be traded, so it is funded at creation — an account
 * with a zero balance rejects every order with INSUFFICIENT_FUNDS, which reads
 * to a new user as "the app is broken".
 *
 * The opening balance is a real ledger posting, not a stored number. That means
 * paper money and real money move through exactly the same code path, so the
 * path is exercised long before it is trusted with anything.
 */

const { Money } = require("./money");
const ledger = require("./ledger");
const { Account } = require("../models");

const DEFAULT_PAPER_BALANCE = process.env.PAPER_OPENING_BALANCE || "100000";

async function createAccount({
  userId,
  name = "Paper",
  kind = "paper",
  venue = "internal",
  baseCurrency = process.env.DEFAULT_CURRENCY || "INR",
  openingBalance = null,
}) {
  const account = await Account.create({ userId, name, kind, venue, baseCurrency });

  // Only paper accounts get free money. A demo or live account is funded by
  // the broker, and inventing a balance for one would put our books
  // permanently out of step with theirs.
  const amount = openingBalance ?? (kind === "paper" ? DEFAULT_PAPER_BALANCE : null);
  if (amount && Number(amount) > 0) {
    await ledger.deposit({
      userId,
      accountId: account._id,
      money: Money.parse(String(amount), baseCurrency),
      memo: "opening balance",
    });
  }
  return account;
}

/**
 * Add funds to a paper account.
 *
 * Refuses on anything other than a paper account: crediting a live account
 * from our side would mean claiming money the broker does not think we have.
 */
async function deposit({ account, userId, amount, memo = "deposit" }) {
  if (account.kind !== "paper") {
    const err = new Error(
      `cannot credit a ${account.kind} account from here; fund it at the broker`
    );
    err.code = "NOT_PAPER_ACCOUNT";
    err.status = 403;
    throw err;
  }
  const money = Money.parse(String(amount), account.baseCurrency);
  if (!money.isPositive()) {
    const err = new Error("deposit must be positive");
    err.code = "BAD_AMOUNT";
    err.status = 400;
    throw err;
  }
  await ledger.deposit({ userId, accountId: account._id, money, memo });
  return ledger.balances(account._id, account.baseCurrency);
}

/**
 * Reset a paper account to its opening balance.
 *
 * Implemented as a corrective POSTING, never by deleting history: the ledger is
 * append-only, and "what happened, then what we did about it" is more useful
 * than a clean slate that hides a bad run.
 */
async function resetPaperAccount({ account, userId, to = DEFAULT_PAPER_BALANCE }) {
  if (account.kind !== "paper") {
    const err = new Error("only paper accounts can be reset");
    err.code = "NOT_PAPER_ACCOUNT";
    err.status = 403;
    throw err;
  }
  const currency = account.baseCurrency;
  const current = await ledger.balances(account._id, currency);
  const target = Money.parse(String(to), currency);
  const delta = target.minus(current.equity);

  if (!delta.isZero()) {
    await ledger.post([
      {
        userId, accountId: account._id, bucket: "cash",
        direction: delta.isPositive() ? "debit" : "credit",
        money: delta.abs(), reason: "adjustment", memo: "paper account reset",
      },
      {
        userId, accountId: account._id, bucket: "external",
        direction: delta.isPositive() ? "credit" : "debit",
        money: delta.abs(), reason: "adjustment", memo: "paper account reset",
      },
    ]);
  }
  return ledger.balances(account._id, currency);
}

module.exports = { createAccount, deposit, resetPaperAccount, DEFAULT_PAPER_BALANCE };
