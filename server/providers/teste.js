/* =========================================================
   Provedor Pix de TESTE — não cobra nada.
   Gera um código fictício e o pagamento é simulado pelo botão
   "Simular pagamento" que só aparece neste modo.
   Na versão final este arquivo é substituído pelo provedor do gateway
   (ex.: providers/mercadopago.js) com PIX_PROVIDER=mercadopago.
   ========================================================= */
module.exports = {
  nome: "teste (simulado)",
  teste: true,

  async criarCobranca({ pedidoId, valor }) {
    return {
      txid: "TESTE" + pedidoId,
      // código propositalmente inválido: nenhum banco aceita pagar isto
      copiaECola: `PIX-DE-TESTE|PEDIDO:${pedidoId}|VALOR:${valor.toFixed(2)}|NAO-PAGAR`,
    };
  },

  // no modo teste o status só muda pela rota /api/teste/pagar
  async consultar() { return null; },
};
