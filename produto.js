/* =========================================================
   CATÁLOGO E PREÇOS — fonte única, usada pelo site E pelo servidor.
   O servidor recalcula o total a partir daqui; o valor enviado pelo navegador é ignorado.
   ========================================================= */
(function (root) {
  const PRODUTO = {
    nome: "Árvore De Natal Pinheiro Tradicional Luxo Cheia",
    // desconto sobre o preço "de" (old). Preço final = old × (1 − discount), arredondado para baixo em ,90
    discount: 0.50,
    // cupom extra da loja em R$ por item (0 = sem cupom). Só use se o cupom existir de verdade.
    cupom: 0,
    maxQty: 10,
    // "old" = preço cheio REAL de cada tamanho (o "de"). Só o de 1,5 m (R$ 199,90) veio do print — confira os demais.
    variants: [
      { name: "1,5 m", code: "AT150", cm: 150, label: "1.5m - 450 Galhos",  img: "img/opcao-1.webp", old: 199.90, galhos: "450",   diam: "80 cm",  base: "35 cm" },
      { name: "1,8 m", code: "AT180", cm: 180, label: "1.8m - 800 Galhos",  img: "img/opcao-2.webp", old: 253.20, galhos: "800",   diam: "104 cm", base: "45 cm" },
      { name: "2,1 m", code: "AT210", cm: 210, label: "2.1m - 1200 Galhos", img: "img/opcao-3.webp", old: 333.20, galhos: "1.200", diam: "110 cm", base: "50 cm" },
      { name: "2,4 m", code: "AT240", cm: 240, label: "2.4m - 1500 Galhos", img: "img/opcao-4.webp", old: 426.50, galhos: "1.500", diam: "145 cm", base: "55 cm" },
      { name: "2,7 m", code: "AT270", cm: 270, label: "2.7m - 2000 Galhos", img: "img/opcao-5.webp", old: 533.20, galhos: "2.000", diam: "160 cm", base: "60 cm" },
      { name: "3 m",   code: "AT300", cm: 300, label: "3.0m - 2500 Galhos", img: "img/opcao-6.webp", old: 653.20, galhos: "2.500", diam: "170 cm", base: "95 cm" },
    ],
  };

  // ORDER BUMPS — ofertas extras no checkout (1 unidade cada, marcadas pelo cliente).
  //   price = preço da oferta · old = preço "de" REAL (opcional; sem ele não mostra riscado nem %)
  //   img = foto em img/bumps/ (se não existir, aparece um ícone)
  //   cores = opções que o cliente escolhe (opcional) · corPadrao = já vem marcada
  PRODUTO.bumps = [
    { id: "cortina", nome: "Cortina 300 LEDs 3x3 USB - Pisca Pisca 8 Modos de Iluminação", desc: "8 modos de iluminação · USB",
      old: 74.90, price: 24.90, img: "img/bumps/cortina.webp", icone: "pisca" },
    { id: "bolas", nome: "Kit 100 Bolas De Natal Mistas Lisas Glitter Decoração Enfeite Arvore de Natal", desc: "Escolha a cor:",
      old: 114.90, price: 44.90, img: "img/bumps/bolas.webp", icone: "bolas",
      cores: ["Prata", "Azul", "Branco", "Vermelho + Dourado", "Vermelho", "Dourado"], corPadrao: "Vermelho + Dourado" },
  ];

  // preço com desconto, terminando em ,90 e nunca acima do desconto anunciado
  PRODUTO.variants.forEach(v => {
    const h = v.old * (1 - PRODUTO.discount);
    let p = Math.floor(h) + 0.9;
    if (p > h + 1e-9) p -= 1;
    v.price = +p.toFixed(2);
  });

  // totais de um pedido (centavos inteiros para não acumular erro de arredondamento)
  PRODUTO.calcular = function (variantIndex, qty, bumpIds) {
    const v = PRODUTO.variants[variantIndex];
    const c = n => Math.round(n * 100);
    const bumps = PRODUTO.bumps.filter(b => (bumpIds || []).includes(b.id));
    const original = c(v.old) * qty;
    const subtotal = c(v.price) * qty;
    const cupom = Math.min(c(PRODUTO.cupom) * qty, subtotal);
    const bumpsOriginal = bumps.reduce((s, b) => s + c(b.old || b.price), 0);
    const bumpsTotal = bumps.reduce((s, b) => s + c(b.price), 0);
    const total = subtotal - cupom + bumpsTotal;
    return {
      variant: v, qty, bumps,
      itens: qty + bumps.length,
      original: original / 100,
      descontoProduto: (original - subtotal) / 100,
      subtotal: subtotal / 100,
      cupom: cupom / 100,
      bumpsTotal: bumpsTotal / 100,
      total: total / 100,
      economia: (original - subtotal + cupom + bumpsOriginal - bumpsTotal) / 100,
    };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PRODUTO;
  else root.PRODUTO = PRODUTO;
})(typeof window !== "undefined" ? window : globalThis);
