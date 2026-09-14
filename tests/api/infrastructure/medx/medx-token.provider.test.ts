import { describe, it, expect, vi, afterEach } from "vitest";
import { criarTokenProvider } from "../../../../src/api/infrastructure/medx/medx-token.provider.js";

const respostaOk = (token: string) =>
  new Response(
    JSON.stringify({ accessToken: token, tokenType: "Bearer", expiresInSeconds: 900, scope: "" }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

const opcoes = { host: "https://medx.test", integrationToken: "tk" };

afterEach(() => vi.restoreAllMocks());

describe("criarTokenProvider", () => {
  it("busca o token na primeira chamada", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    expect(await criarTokenProvider(opcoes).obterToken()).toBe("jwt-1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("posta o IntegrationToken no corpo, no endpoint certo", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    await criarTokenProvider(opcoes).obterToken();

    expect(String(spy.mock.calls[0]![0])).toBe("https://medx.test/api/integration/token");
    expect(JSON.parse(String(spy.mock.calls[0]![1]!.body))).toEqual({ IntegrationToken: "tk" });
  });

  it("reaproveita o token dentro da validade", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await p.obterToken();
    await p.obterToken();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("renova quando faltam menos de 120s para expirar", async () => {
    let agora = 0;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respostaOk("jwt-1"))
      .mockResolvedValueOnce(respostaOk("jwt-2"));

    const p = criarTokenProvider({ ...opcoes, agora: () => agora });
    expect(await p.obterToken()).toBe("jwt-1");
    agora = 800_000; // restam 100s
    expect(await p.obterToken()).toBe("jwt-2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("colapsa chamadas concorrentes numa única requisição", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await Promise.all([p.obterToken(), p.obterToken(), p.obterToken()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("busca de novo depois de invalidar", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respostaOk("jwt-1"))
      .mockResolvedValueOnce(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await p.obterToken();
    p.invalidar();
    await p.obterToken();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("propaga erro quando o token de integração é recusado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(criarTokenProvider(opcoes).obterToken()).rejects.toThrow(/401/);
  });
});
