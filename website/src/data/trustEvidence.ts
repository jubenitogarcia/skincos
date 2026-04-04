export type TrustEvidenceUnit = {
  slug: string;
  name: string;
  locality: string;
  rating: number;
  userRatingsTotal: number;
  photos: number;
  positiveQuote: string;
  positiveAuthor: string;
  positiveRating: number;
};

export const TRUST_EVIDENCE_CAPTURED_AT = "2026-03-26";

export const TRUST_EVIDENCE_UNITS: TrustEvidenceUnit[] = [
  {
    slug: "barrashoppingsul",
    name: "BarraShoppingSul",
    locality: "Porto Alegre",
    rating: 4.6,
    userRatingsTotal: 61,
    photos: 10,
    positiveQuote:
      "Atendimento maravilhoso, ambiente lindo! Procedimentos feito com segurança e excelência, parabéns ao médico e a equipe.",
    positiveAuthor: "Estela Almeida",
    positiveRating: 5,
  },
  {
    slug: "novo-hamburgo",
    name: "Novo Hamburgo",
    locality: "Novo Hamburgo",
    rating: 4.8,
    userRatingsTotal: 150,
    photos: 10,
    positiveQuote:
      "Sinto total confiança na equipe. Sempre sou muito bem atendida e os procedimentos ficam ótimos. Nada de exagero e respeitando a anatomia natural do rosto.",
    positiveAuthor: "Jéssica Mazilli dos Reis",
    positiveRating: 5,
  },
];

export function getTrustEvidenceSummary() {
  const totalReviews = TRUST_EVIDENCE_UNITS.reduce((sum, unit) => sum + unit.userRatingsTotal, 0);
  const totalPhotos = TRUST_EVIDENCE_UNITS.reduce((sum, unit) => sum + unit.photos, 0);
  const weightedRatingBase = TRUST_EVIDENCE_UNITS.reduce(
    (sum, unit) => sum + unit.rating * unit.userRatingsTotal,
    0,
  );

  return {
    totalReviews,
    totalPhotos,
    weightedRating: totalReviews > 0 ? weightedRatingBase / totalReviews : 0,
  };
}
