export type Doctor = {
  slug: string;
  name: string;
  days?: string;
  image?: string;
  bookingUrl?: string;
};

export const doctors: Doctor[] = [
  {
    "slug": "drmarcelogsoares",
    "name": "Dr. Marcelo Soares",
    "days": "Sexta-feira",
    "bookingUrl": "https://espacofacial.com/drmarcelogsoares"
  },
  {
    "slug": "drasamarassilva",
    "name": "Dra. Samara Silva",
    "days": "Sábado",
    "bookingUrl": "https://espacofacial.com/drasamarassilva"
  },
  {
    "slug": "dravivianemondin",
    "name": "Dra. Viviane Mondin",
    "days": "Segunda-feira, Quinta-feira",
    "bookingUrl": "https://espacofacial.com/dravivianemondin"
  },
  {
    "slug": "drajosielesouza",
    "name": "Dra. Josiele de Souza",
    "days": "Segunda-feira, Terça-feira, Sexta-feira",
    "bookingUrl": "https://espacofacial.com/drajosielesouza"
  },
  {
    "slug": "drviniciusvieira",
    "name": "Dr. Vinícius Vieira",
    "days": "Terça-feira, Quarta-feira",
    "bookingUrl": "https://espacofacial.com/drviniciusvieira"
  },
  {
    "slug": "dragabrielamenegat",
    "name": "Dra. Gabriela Menegat",
    "days": "Quarta-feira, Sábado",
    "bookingUrl": "https://espacofacial.com/dragabrielamenegat"
  }
];
