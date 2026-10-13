// Testes da expressão cwmp.auth (npm test).

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAuthExpression } from "../acs/auth-expr.js";

const A = { username: "zenie", password: "SenhaForte123" };
const B = { username: "zenie", password: "SenhaAntiga456" };

test("desligado remove a chave", () => {
  assert.equal(buildAuthExpression("off", []), null);
});

test("exigido: todas as credenciais aceitas com OR (troca de senha sem queda)", () => {
  assert.equal(buildAuthExpression("enforced", [A, B]), 'AUTH("zenie","SenhaForte123") OR AUTH("zenie","SenhaAntiga456")');
});

test("exigir sem credencial é recusado", () => {
  assert.throws(() => buildAuthExpression("enforced", []));
});

test("valores que quebrariam a expressão são recusados", () => {
  for (const bad of ['a"b', "a b", "a\\b", 'x") OR TRUE OR ("', "", "a;b"]) {
    assert.throws(() => buildAuthExpression("enforced", [{ username: bad, password: "SenhaForte123" }]), bad);
    assert.throws(() => buildAuthExpression("enforced", [{ username: "zenie", password: bad }]), bad);
  }
});
