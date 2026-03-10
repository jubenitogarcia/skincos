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
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/drmarcelogsoares"
  },
  {
    "slug": "drasamarassilva",
    "name": "Dra. Samara Silva",
    "days": "Sábado",
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/drasamarassilva"
  },
  {
    "slug": "dravivianemondin",
    "name": "Dra. Viviane Mondin",
    "days": "Segunda-feira, Quinta-feira",
    "image": "/images/579A1718.png",
    "bookingUrl": "https://www.espacofacial.com/dravivianemondin"
  },
  {
    "slug": "drajosielesouza",
    "name": "Dra. Josiele de Souza",
    "days": "Segunda-feira, Terça-feira, Sexta-feira",
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/drajosielesouza"
  },
  {
    "slug": "dramarinalima",
    "name": "Dra. Marina Lima",
    "days": "Quinta-feira",
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/dramarinalima"
  },
  {
    "slug": "drviniciusvieira",
    "name": "Dr. Vinícius Vieira",
    "days": "Terça-feira, Quarta-feira",
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/drviniciusvieira"
  },
  {
    "slug": "dragabrielamenegat",
    "name": "Dra. Gabriela Menegat",
    "days": "Quarta-feira, Sábado",
    "image": "/images/579A1718.jpg",
    "bookingUrl": "https://www.espacofacial.com/dragabrielamenegat"
  }
];
