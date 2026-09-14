export class ErroMedx extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroMedx";
  }
}

export class ErroRateLimit extends ErroMedx {
  constructor(readonly esperarSegundos: number) {
    super(429, `Rate limit do MedX atingido; aguardar ${esperarSegundos}s`);
    this.name = "ErroRateLimit";
  }
}
