const PRESERVE_QUERYSTRING = true;

const REDIRECTS: Record<string, string> = {
  // BarraShoppingSul
  "/bss/comochegar": "https://www.google.com/maps/place/Espaço+Facial/@-30.0846697,-51.2458384,17z/data=!3m1!4b1!4m6!3m5!1s0x9519795c306ed865:0xb5f05aac9b865daa!8m2!3d-30.0846697!4d-51.2458384!16s%2Fg%2F11vywknzbf?entry=ttu&g_ep=EgoyMDI1MDMxMS4wIKXMDSoASAFQAw%3D%3D",
  "/bss/faleconosco": "https://wa.me/message/MT7UGL6U6KYWA1",
  "/bss/faleconsco": "https://wa.me/message/MT7UGL6U6KYWA1",
  "/bss/fb": "https://www.facebook.com/espacofacial.barrashoppingsul",
  "/bss/giftcard": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero presentear _alguém especial_ com o *Cartão Presente* da _Espaço Facial_ – *autoestima, beleza e bem-estar* em forma de presente! 💝",
  "/bss/ig": "https://www.instagram.com/espacofacial_barrashoppingsul",
  "/bss/alopecia": "https://payment-link-v3.stone.com.br/pl_7ezVNbW1nym2D4cz4IVa2rR0DxXJYdLP",
  "/bss/clubebotox": "https://payment-link-v3.stone.com.br/pl_lqrbavJ9pR50k6HBBt48jYoAPENQXxek",
  "/bss/clubelavieen": "https://payment-link-v3.stone.com.br/pl_r1gLZjbQ3nX4E7UKQfXEYwRO9Eom7GlV",
  "/bss/nosavalie": "https://g.page/r/CapdhpusWvC1EBM/review",
  "/bss/vip": "https://chat.whatsapp.com/KsZ5LtGtXcCAg4HyyDWnSo",

  // Novo Hamburgo
  "/nh/comochegar": "https://www.google.com/maps/dir//Espaço+Facial+-+Av.+Dr.+Maurício+Cardoso,+1126+-+Jardim+Mauá,+Novo+Hamburgo+-+RS,+93548-515/@-29.6817035,-51.1190928,17z/data=!4m9!4m8!1m0!1m5!1m1!1s0x951943d467aca085:0x23f81b926e34d27b!2m2!1d-51.1190928!2d-29.6817035!3e0?entry=ttu&g_ep=EgoyMDI1MDMxMS4wIKXMDSoASAFQAw%3D%3D",
  "/nh/fb": "https://www.facebook.com/espacofacial.novohamburgo",
  "/nh/fgts": "https://auto.bsbank.com.br/fgts-parceiro?partner=7deea206-1e21-41ff-be10-a3e1d4ce95cb",
  "/nh/giftcard": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero presentear _alguém especial_ com o *Cartão Presente* da _Espaço Facial_ – *autoestima, beleza e bem-estar* em forma de presente! 💝",
  "/nh/ig": "https://www.instagram.com/espacofacial_novohamburgo",
  "/nh/alopecia": "https://payment-link-v3.stone.com.br/pl_JQ4p9nYxmGaNDO92slTBbZEdL76R1gX8",
  "/nh/clubebotox": "https://payment-link-v3.stone.com.br/pl_2xNX5qopbEQAOw2iGHqbL9wdP8VRGYkB",
  "/nh/clubelavieen": "https://payment-link-v3.stone.com.br/pl_QypjlV90JAxoW7DzTnfY8X46qDe7EO15",
  "/nh/faleconosco": "https://wa.me/message/5ZD2K6FMTDVSC1",
  "/nh/nosavalie": "https://g.page/r/CXvSNG6SG_gjEBM/review",
  "/nh/vip": "https://chat.whatsapp.com/EldkIVerELzESZKW8Iephz",

  // Campanhas
  "/bebadessafonte": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+HealthBodyRun+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",

  // Interno
  "/sugereaqui": "https://espacofacial.com/sugereaqui",

  // Doutores - BSS
  "/bss/dragabrielamenegat": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Gabriela%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/bss/dramarinalima": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Marina%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/bss/drasamarassilva": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Samara%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/bss/dravivianemondin": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Viviane%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/bss/drmarcelogsoares": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20o%20%2ADr.%20Marcelo%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/bss/drviniciusvieira": "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20o%20%2ADr.%20Vinícius%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",

  // Doutores - NH
  "/nh/dragabrielamenegat": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Gabriela%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/drajosielesouza": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Josiele%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/dramarinalima": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Marina%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/drasamarassilva": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Samara%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/dravivianemondin": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20a%20%2ADra.%20Viviane%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/drmarcelogsoares": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20o%20%2ADr.%20Marcelo%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
  "/nh/drviniciusvieira": "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20com%20o%20%2ADr.%20Vinícius%2A%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",

  // Short URLs (campanhas)
  "/alineschneidertv": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40alineschneidertv+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/amandahlr": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40amandahlr+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/amandameraa": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40amandameraa+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/amandawinck": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40amandawinck+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/aquelaminah": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40aquelaminah+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/braian_fiori29": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40braian_fiori29+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/brechobalonefebassi": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40brechobalonefebassi+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/brunamaralf": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40brunamaralf+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/carotremarin": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40carotremarin+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/denifreitas": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40denifreitas+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/dudaandradix": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40dudaandradix+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/dudamuniz_": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40dudamuniz_+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/eliseufrenzel": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40eliseufrenzel+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/erlethnunes": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40erlethnunes+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/fefcv": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40fefcv+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/felipebkin": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40felipebkin+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/gabipospichil": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40gabipospichil+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/garcom_modelo": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40garcom_modelo+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/geschwertner": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40geschwertner+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/ggabrielaavilaa": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40ggabrielaavilaa+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/greice_marczewski": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40greice_marczewski+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/gusgho": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40gusgho+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/isaaaacardoso_": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40isaaaacardoso_+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/jaine_fernanda": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40jaine_fernanda+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/jubenitogarcia": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40jubenitogarcia+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/juliacarpess": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40juliacarpess+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/kesllyvargas": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40kesllyvargas+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/lanadarlling": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40lanadarlling+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/lucasf_if": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40lucasf_If+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/luisaaraamos": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40luisaaraamos+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/marianajreck": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40marianajreck+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/mbmarianaboni": "https://api.whatsapp.com/send?phone=5551980882293&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40mbmarianaboni+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/micheletcorrea": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40micheletcorrea+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/morganawinck": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40morganawinck+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/nataliablauth.fadadascores": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40nataliablauth.fadadascores+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/nicolehummes": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40nicolehummes+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/nitametz": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40nitametz+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/o_matheus_rosaa": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40o_matheus_rosaa+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/palomamaino": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40palomamaino+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/pamelabernardini": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40pamelabernardini+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/personalfernandonunes": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40personalfernandonunes+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/popysmartins": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40popysmartins+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/renobree": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40renobree+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/samuel.santana.nh": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+do+%40samuel.santana.nh+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/steveigaa": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40steveigaa+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
  "/valykonrath": "https://api.whatsapp.com/send?phone=5551995811008&text=Ganhei+um+%2Adesconto+exclusivo%2A+da+%40valykonrath+para+o+meu+momento+de+%2Aauto-cuidado+e+bem-estar%2A+na+Espa%C3%A7o+Facial.+Quero+saber+mais%21+%F0%9F%92%A5",
};

function normalizePath(pathname: string): string {
  const lower = pathname.toLowerCase();
  if (lower.length > 1 && lower.endsWith("/")) return lower.slice(0, -1);
  return lower;
}

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    const targetBase = REDIRECTS[path];
    if (!targetBase) return new Response("Not Found", { status: 404 });

    const target = new URL(targetBase);
    if (PRESERVE_QUERYSTRING && url.search) {
      const targetParams = new URLSearchParams(target.search);
      const incomingParams = new URLSearchParams(url.search);
      for (const [key, value] of incomingParams) {
        targetParams.append(key, value);
      }
      const merged = targetParams.toString();
      target.search = merged ? `?${merged}` : "";
    }

    return Response.redirect(target.toString(), 301);
  },
};

export default worker;
