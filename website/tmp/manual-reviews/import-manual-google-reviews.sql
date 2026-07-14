DELETE FROM gbp_reviews WHERE unit_slug = 'barrashoppingsul';

DELETE FROM gbp_review_summaries WHERE unit_slug = 'barrashoppingsul';

DELETE FROM gbp_review_sync_runs WHERE unit_slug = 'barrashoppingsul';

INSERT INTO gbp_review_summaries (
      unit_slug, place_id, gbp_location, location_resource_name,
      average_rating, total_reviews, reviews_synced, synced_at_ms,
      created_at_ms, updated_at_ms
    ) VALUES (
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      '5938225121025805282',
      NULL,
      4.623,
      61,
      61,
      1775083285374,
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tkd2RtMUhVM3A2YTBKV1kzZE9iV2hHVDBwMk0xRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Pyetra Irassochio',
      1,
      'Fui em um retorno na qual eu não contratei mais pacotes. E fui super mal tratada. Fui com meu marido e filho, afinal era um retorno, algo rápido. A secretária ofereceu água ou café. Eu aceitei a água e perguntei se meu esposo queria café  (ela não ofereceu para ele). O mesmo aceitou o café, no qual ela me deu UM copo de água e o café não foi entregue em NENHUM momento. Ou seja, eu tive que dividir o único copo de água que foi entregue com meu marido e filho (de 5 anos). Fora a cara que a secretária estava, parecia que estávamos implorando por algo. A Dra. mal olhou no meu rosto. Na penúltima consulta ela tirou um pouco de ácido do meu lábio e disse que se necessário iria repor no próximo ( eu não pedi para retirar, afinal, eu paguei). Resumido, fui mal atendida, destrataram a minha família e sai insatisfeita com meu lábio.',
      1767307285374,
      1767307285374,
      NULL,
      1767307285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":0,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tkd2RtMUhVM3A2YTBKV1kzZE9iV2hHVDBwMk0xRRAB","name":"Pyetra Irassochio","rating":1,"timeText":"3 meses atrás","text":"Fui em um retorno na qual eu não contratei mais pacotes. E fui super mal tratada. Fui com meu marido e filho, afinal era um retorno, algo rápido. A secretária ofereceu água ou café. Eu aceitei a água e perguntei se meu esposo queria café  (ela não ofereceu para ele). O mesmo aceitou o café, no qual ela me deu UM copo de água e o café não foi entregue em NENHUM momento. Ou seja, eu tive que dividir o único copo de água que foi entregue com meu marido e filho (de 5 anos). Fora a cara que a secretária estava, parecia que estávamos implorando por algo. A Dra. mal olhou no meu rosto. Na penúltima consulta ela tirou um pouco de ácido do meu lábio e disse que se necessário iria repor no próximo ( eu não pedi para retirar, afinal, eu paguei). Resumido, fui mal atendida, destrataram a minha família e sai insatisfeita com meu lábio.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tKeExXaDBZMDV5UVdGT1V6Y3RXblJOZVRnMmFVRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Fabíola Campos',
      1,
      'Não recomendo, entrei em contato pelo WhatsApp após ver anúncios no Instagram, aonde o preenchimento estava pelo valor de 499. Pelo WhatsApp pedi mais informações e me foi enviado esse mesmo valor da propaganda do instagram, marquei horário e novamente confirmei o valor. Um pouco antes do horário agendado, quando já estava a caminho do local eles mandam uma mensagem dizendo que seria outro valor. Total descaso, falta de respeito e consideração com o cliente.',
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":1,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tKeExXaDBZMDV5UVdGT1V6Y3RXblJOZVRnMmFVRRAB","name":"Fabíola Campos","rating":1,"timeText":"4 meses atrás","text":"Não recomendo, entrei em contato pelo WhatsApp após ver anúncios no Instagram, aonde o preenchimento estava pelo valor de 499. Pelo WhatsApp pedi mais informações e me foi enviado esse mesmo valor da propaganda do instagram, marquei horário e novamente confirmei o valor. Um pouco antes do horário agendado, quando já estava a caminho do local eles mandam uma mensagem dizendo que seria outro valor. Total descaso, falta de respeito e consideração com o cliente.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xGV1FYaFZPRkp5VWxkaFMzSklSREZuWDFsb1pGRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Karina Tavares',
      5,
      'Fui muito bem atendida quando cheguei, a Dra. me explicou sobre os procedimentos, já iniciei e agora seguirei com os procedimentos com as meninas',
      1769899285374,
      1769899285374,
      NULL,
      1769899285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":2,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xGV1FYaFZPRkp5VWxkaFMzSklSREZuWDFsb1pGRRAB","name":"Karina Tavares","rating":5,"timeText":"2 meses atrás","text":"Fui muito bem atendida quando cheguei, a Dra. me explicou sobre os procedimentos, já iniciei e agora seguirei com os procedimentos com as meninas","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pGUWVqSkdSVTAwUVcwM1lVRjVWVk5FY25admFIYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Josiane Souza dos Santos',
      5,
      'Apesar de terem me passado algumas informações incorretas, gostei bastante sim...
Médica que me atendeu ótima profissional
Parabéns,😘🙌 …',
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":3,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pGUWVqSkdSVTAwUVcwM1lVRjVWVk5FY25admFIYxAB","name":"Josiane Souza dos Santos","rating":5,"timeText":"4 meses atrás","text":"Apesar de terem me passado algumas informações incorretas, gostei bastante sim...\nMédica que me atendeu ótima profissional\nParabéns,😘🙌 …","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25reFpFTnBTVWRCWjFOc1gyTk5PRVJKY1VSdFVGRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Estela Almeida',
      5,
      'Atendimento maravilhoso, ambiente lindo! Procedimentos feito com segurança e excelência, parabéns ao médico e a equipe !!!',
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":4,"id":"Ci9DQUlRQUNvZENodHljRjlvT25reFpFTnBTVWRCWjFOc1gyTk5PRVJKY1VSdFVGRRAB","name":"Estela Almeida","rating":5,"timeText":"Editado 4 meses atrás","text":"Atendimento maravilhoso, ambiente lindo! Procedimentos feito com segurança e excelência, parabéns ao médico e a equipe !!!","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pkUFdYTlhNbTh5Wnkxd05ubHdUVlZLYUZBMGRIYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Cris Nicolay',
      5,
      'Sempre sou muito bem atendida por todas. A Dra Marina é excepcional, confio nela e me sinto segura em fazer qualquer procedimento.',
      1759531285374,
      1759531285374,
      NULL,
      1759531285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":5,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pkUFdYTlhNbTh5Wnkxd05ubHdUVlZLYUZBMGRIYxAB","name":"Cris Nicolay","rating":5,"timeText":"6 meses atrás","text":"Sempre sou muito bem atendida por todas. A Dra Marina é excepcional, confio nela e me sinto segura em fazer qualquer procedimento.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xGT2RrZGpXSEpRWDBwdGRUaHlkblUyTkZrdFUyYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'FABI BUZZACARO',
      5,
      'Equipe muito atenciosa! Fiz botox em 2 dias já senti o resultado. Clínica tem um ótimo acolhimento.',
      1754347285374,
      1754347285374,
      'Olá Fabi!
Que alegria receber seu feedback! 💙 Ficamos muito felizes em saber que você sentiu o resultado do Botox tão rápido e se sentiu acolhida por nossa equipe. Trabalhamos com muito carinho para proporcionar exatamente isso: resultados eficazes e uma experiência humana, segura e acolhedora. Volte sempre que quiser, será um prazer te receber! ✨',
      1754347285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":6,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xGT2RrZGpXSEpRWDBwdGRUaHlkblUyTkZrdFUyYxAB","name":"FABI BUZZACARO","rating":5,"timeText":"8 meses atrás","text":"Equipe muito atenciosa! Fiz botox em 2 dias já senti o resultado. Clínica tem um ótimo acolhimento.","ownerResponse":"Olá Fabi!\nQue alegria receber seu feedback! 💙 Ficamos muito felizes em saber que você sentiu o resultado do Botox tão rápido e se sentiu acolhida por nossa equipe. Trabalhamos com muito carinho para proporcionar exatamente isso: resultados eficazes e uma experiência humana, segura e acolhedora. Volte sempre que quiser, será um prazer te receber! ✨"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21WeVFsVkZZa0ZMVTJNNWIzbEJObEV5ZDA5b1ZWRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Daniely Reis',
      1,
      'Péssima experiências no atendimento do estabelecimento com a profissional Gabriela, extremante despreparada, mal educada debochada e arrogante.',
      1762123285374,
      1762123285374,
      NULL,
      1762123285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":7,"id":"Ci9DQUlRQUNvZENodHljRjlvT21WeVFsVkZZa0ZMVTJNNWIzbEJObEV5ZDA5b1ZWRRAB","name":"Daniely Reis","rating":1,"timeText":"5 meses atrás","text":"Péssima experiências no atendimento do estabelecimento com a profissional Gabriela, extremante despreparada, mal educada debochada e arrogante.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21KeWFHVXhaRkIyV0hwRGVUVnZNbTg1UTJvNGRuYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Clau Hummes',
      5,
      'Adorei tudo. A recepção é acolhedora, muito receptiva e a Dra. é maravilhosa: explica, tem mãos de fada, entrega o combinado, achei preço muito justo. Sensacional. Super indico. O espaço tem minha fidelidade.',
      1751755285374,
      1751755285374,
      'Olá Clau!
Uau, que feedback maravilhoso! 🥰 Muito obrigado por cada palavra! Ficamos imensamente felizes em saber que você se sentiu acolhida, bem atendida e satisfeita com os resultados. Nosso maior compromisso é justamente esse: entregar excelência com transparência, carinho e responsabilidade. 💙 Saber que conquistamos sua fidelidade é uma grande honra! Estaremos sempre de braços abertos para te receber!',
      1751755285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":8,"id":"Ci9DQUlRQUNvZENodHljRjlvT21KeWFHVXhaRkIyV0hwRGVUVnZNbTg1UTJvNGRuYxAB","name":"Clau Hummes","rating":5,"timeText":"9 meses atrás","text":"Adorei tudo. A recepção é acolhedora, muito receptiva e a Dra. é maravilhosa: explica, tem mãos de fada, entrega o combinado, achei preço muito justo. Sensacional. Super indico. O espaço tem minha fidelidade.","ownerResponse":"Olá Clau!\nUau, que feedback maravilhoso! 🥰 Muito obrigado por cada palavra! Ficamos imensamente felizes em saber que você se sentiu acolhida, bem atendida e satisfeita com os resultados. Nosso maior compromisso é justamente esse: entregar excelência com transparência, carinho e responsabilidade. 💙 Saber que conquistamos sua fidelidade é uma grande honra! Estaremos sempre de braços abertos para te receber!"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURfMGN5ZHR3RRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Thais Vanessa',
      1,
      'Vou editar meu comentário de fevereiro, mas vou manter aqui abaixo só pra vocês terem uma ideia da decadência:
Não gastem dinheiro com esta unidade. Já foi ótima, aparentemente tudo mudou e o botox que eles estão aplicando simplesmente não funciona nada, se é que não piora - tenho fotos de antes e depois das aplicações e posso afirmar que conseguiram afundar mais a minha glabela. É aplicado muito pouco produto com relação ao que era feito até o início do ano. Não sei o quanto é diluído. Não te é mostrado material/produto, não te falam quantidade, enfim... Acabaram com a unidade, era ótima e está péssima. Nem as meninas que me atendiam até o início do ano estão mais lá. NÃO GASTEM SEU DINHEIRO AQUI.

Comentário de fevereiro:
Fiz botox com a Dra Marina Lima. Quando vi a mocinha, pensei: será que essa menina com a idade da minha filha sabe o que está fazendo?
Olha, não se enganem pela aparência jovial: a bichinha sabe exatamente o que faz.
Já havia feito botox em outros 7 lugares, alguns de muito renome, e ninguém antes conseguiu preencher minha glabela como ela. Gratidão, Dra Marina,e parabéns pelo trabalho incrível!',
      1764715285374,
      1764715285374,
      'Olá Thais! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":9,"id":"ChdDSUhNMG9nS0VJQ0FnSURfMGN5ZHR3RRAB","name":"Thais Vanessa","rating":1,"timeText":"Editado 4 meses atrás","text":"Vou editar meu comentário de fevereiro, mas vou manter aqui abaixo só pra vocês terem uma ideia da decadência:\nNão gastem dinheiro com esta unidade. Já foi ótima, aparentemente tudo mudou e o botox que eles estão aplicando simplesmente não funciona nada, se é que não piora - tenho fotos de antes e depois das aplicações e posso afirmar que conseguiram afundar mais a minha glabela. É aplicado muito pouco produto com relação ao que era feito até o início do ano. Não sei o quanto é diluído. Não te é mostrado material/produto, não te falam quantidade, enfim... Acabaram com a unidade, era ótima e está péssima. Nem as meninas que me atendiam até o início do ano estão mais lá. NÃO GASTEM SEU DINHEIRO AQUI.\n\nComentário de fevereiro:\nFiz botox com a Dra Marina Lima. Quando vi a mocinha, pensei: será que essa menina com a idade da minha filha sabe o que está fazendo?\nOlha, não se enganem pela aparência jovial: a bichinha sabe exatamente o que faz.\nJá havia feito botox em outros 7 lugares, alguns de muito renome, e ninguém antes conseguiu preencher minha glabela como ela. Gratidão, Dra Marina,e parabéns pelo trabalho incrível!","ownerResponse":"Olá Thais! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pKbmIwNU1abTR6VWw5RlJGcFRVMlZVTTBOVVlXYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'conservationBR',
      3,
      'O modo que foi aplicado o produto não me garantiu um resultado como eu esperava.',
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":10,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pKbmIwNU1abTR6VWw5RlJGcFRVMlZVTTBOVVlXYxAB","name":"conservationBR","rating":3,"timeText":"4 meses atrás","text":"O modo que foi aplicado o produto não me garantiu um resultado como eu esperava.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYcmZINHdRRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Kelly Rocha',
      1,
      'Falta de respeito é como posso definir minha experiência. Na hora de marcar avaliação pelo WhatsApp, não tinha horário nos dias que podia, encaixar a agenda foi bem complicado. Pois bem, marquei em uma terça às 20hs, fiz “hora” na rua para poder estar lá, já que largo do trabalho às 18hs. Cheguei exatamente no meu horário, recebi um tablet para preencher uma ficha, e enquanto o faço, chega uma outra cliente perguntando o valor do procedimento x, a moça responde, pergunta se ela quer fazer uma avaliação naquele momento mesmo, e simplesmente passa ela na minha frente sem preencher ficha nenhuma, enquanto eu, com meu horário marcado, tenho que ficar esperando. 15 minutos depois, a moça da avaliação continua na sala, e eu esperando. Levantei e fui embora, pois se este foi o atendimento pré avaliação, imaginem se houver algum problema depois?
Mas em resumo: quando você contata pelo WhatsApp, agem como se estivessem sendo super requisitados. Lá o que presenciei foi uma atitude desesperada de angariar uma cliente que sequer marcou hora.
Reclamei no WhatsApp e recebi um “lamentamos pelo ocorrido”, sendo que eu gastei com estacionamento e comida na rua, só para fazer hora para este atendimento.',
      1743547285374,
      1743547285374,
      'Olá Kelly! 

Lamentamos profundamente que sua experiência não tenha atendido às suas expectativas. O que você descreveu está longe do padrão de atendimento que nos orgulhamos em oferecer. Agradecemos por compartilhar os detalhes da situação, pois isso nos ajuda a identificar onde podemos melhorar.

Com relação ao ocorrido, iremos reforçar nossos processos para garantir que nenhum cliente passe por esse tipo de situação novamente. Queremos muito reverter essa impressão negativa e proporcionar a você a experiência de qualidade que merece. Caso esteja disposta, gostaríamos de oferecer uma nova avaliação com prioridade na agenda, para que possamos corrigir o erro e prestar o serviço adequado.

Ficamos à sua disposição!',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":11,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYcmZINHdRRRAB","name":"Kelly Rocha","rating":1,"timeText":"um ano atrás","text":"Falta de respeito é como posso definir minha experiência. Na hora de marcar avaliação pelo WhatsApp, não tinha horário nos dias que podia, encaixar a agenda foi bem complicado. Pois bem, marquei em uma terça às 20hs, fiz “hora” na rua para poder estar lá, já que largo do trabalho às 18hs. Cheguei exatamente no meu horário, recebi um tablet para preencher uma ficha, e enquanto o faço, chega uma outra cliente perguntando o valor do procedimento x, a moça responde, pergunta se ela quer fazer uma avaliação naquele momento mesmo, e simplesmente passa ela na minha frente sem preencher ficha nenhuma, enquanto eu, com meu horário marcado, tenho que ficar esperando. 15 minutos depois, a moça da avaliação continua na sala, e eu esperando. Levantei e fui embora, pois se este foi o atendimento pré avaliação, imaginem se houver algum problema depois?\nMas em resumo: quando você contata pelo WhatsApp, agem como se estivessem sendo super requisitados. Lá o que presenciei foi uma atitude desesperada de angariar uma cliente que sequer marcou hora.\nReclamei no WhatsApp e recebi um “lamentamos pelo ocorrido”, sendo que eu gastei com estacionamento e comida na rua, só para fazer hora para este atendimento.","ownerResponse":"Olá Kelly! \n\nLamentamos profundamente que sua experiência não tenha atendido às suas expectativas. O que você descreveu está longe do padrão de atendimento que nos orgulhamos em oferecer. Agradecemos por compartilhar os detalhes da situação, pois isso nos ajuda a identificar onde podemos melhorar.\n\nCom relação ao ocorrido, iremos reforçar nossos processos para garantir que nenhum cliente passe por esse tipo de situação novamente. Queremos muito reverter essa impressão negativa e proporcionar a você a experiência de qualidade que merece. Caso esteja disposta, gostaríamos de oferecer uma nova avaliação com prioridade na agenda, para que possamos corrigir o erro e prestar o serviço adequado.\n\nFicamos à sua disposição!"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQzMEtTTXBnRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Bruna H.',
      5,
      'Super indico!! Melhor clínica de Porto Alegre para procedimentos estéticos com produtos de qualidade e preços acessíveis. O atendimento e os preços são excelentes e o ambiente 100% acolhedor. Profissionais maravilhosos: explicam os procedimentos com clareza, sempre muito atentos aos resultados que as clientes buscam.',
      1743547285374,
      1743547285374,
      'Olá Bruna! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":12,"id":"ChdDSUhNMG9nS0VJQ0FnSUQzMEtTTXBnRRAB","name":"Bruna H.","rating":5,"timeText":"um ano atrás","text":"Super indico!! Melhor clínica de Porto Alegre para procedimentos estéticos com produtos de qualidade e preços acessíveis. O atendimento e os preços são excelentes e o ambiente 100% acolhedor. Profissionais maravilhosos: explicam os procedimentos com clareza, sempre muito atentos aos resultados que as clientes buscam.","ownerResponse":"Olá Bruna! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQzcDRfWWtBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Erleth Nunes',
      5,
      'Excelente atendimento! Profissionais atenciosos e qualificados. Produtos de alta qualidade. Pontualidade no atendimento. Estou me sentindo maravilhosa, esta é a segunda vez que faço botox na Espaço Facial e  pretendo fazer outros procedimentos. Super recomendo!',
      1743547285374,
      1743547285374,
      'Olá Erleth! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":13,"id":"ChdDSUhNMG9nS0VJQ0FnSUQzcDRfWWtBRRAB","name":"Erleth Nunes","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento! Profissionais atenciosos e qualificados. Produtos de alta qualidade. Pontualidade no atendimento. Estou me sentindo maravilhosa, esta é a segunda vez que faço botox na Espaço Facial e  pretendo fazer outros procedimentos. Super recomendo!","ownerResponse":"Olá Erleth! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pSNFdYTjBhVlYxTlc5UGNGaENYM0pSYm10NmNHYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Claudine Streb',
      5,
      'Muito bem atendida pela Dra. Josiele',
      1756939285374,
      1756939285374,
      NULL,
      1756939285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":14,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pSNFdYTjBhVlYxTlc5UGNGaENYM0pSYm10NmNHYxAB","name":"Claudine Streb","rating":5,"timeText":"7 meses atrás","text":"Muito bem atendida pela Dra. Josiele","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25kMWMyVmpiV001YTBaQ2JsSk9XVU0zUWtsUFVFRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Elisyduda Rodrigues',
      5,
      'Aguardando resultados kkk,mas adoro o espaço e as meninas recepção, Dra todas muito queridas.',
      1754347285374,
      1754347285374,
      'Ola Elis!
Adoramos receber sua mensagem! 🥰 Obrigado pelo carinho com nossa equipe — é sempre um prazer te receber aqui! Estamos na torcida pelos resultados e seguimos à disposição para te acompanhar em cada etapa do seu tratamento. 💙 Até a próxima visita! …',
      1754347285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":15,"id":"Ci9DQUlRQUNvZENodHljRjlvT25kMWMyVmpiV001YTBaQ2JsSk9XVU0zUWtsUFVFRRAB","name":"Elisyduda Rodrigues","rating":5,"timeText":"8 meses atrás","text":"Aguardando resultados kkk,mas adoro o espaço e as meninas recepção, Dra todas muito queridas.","ownerResponse":"Ola Elis!\nAdoramos receber sua mensagem! 🥰 Obrigado pelo carinho com nossa equipe — é sempre um prazer te receber aqui! Estamos na torcida pelos resultados e seguimos à disposição para te acompanhar em cada etapa do seu tratamento. 💙 Até a próxima visita! …"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTUNneU9lSXRBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'MARILIA VARELA',
      5,
      'Atendimento ótimo, produtos excepcionais! profissionais bem entendidas de todos procedimentos e protocolos',
      1743547285374,
      1743547285374,
      'Olá Marilia! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":16,"id":"ChdDSUhNMG9nS0VJQ0FnTUNneU9lSXRBRRAB","name":"MARILIA VARELA","rating":5,"timeText":"um ano atrás","text":"Atendimento ótimo, produtos excepcionais! profissionais bem entendidas de todos procedimentos e protocolos","ownerResponse":"Olá Marilia! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUMzbWZDTmdnRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Fe Vargas',
      5,
      'Atendimento maravilhoso, amei o resultado do meu botox e vou voltar para realizar mais. Super indico.',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":17,"id":"ChdDSUhNMG9nS0VJQ0FnSUMzbWZDTmdnRRAB","name":"Fe Vargas","rating":5,"timeText":"um ano atrás","text":"Atendimento maravilhoso, amei o resultado do meu botox e vou voltar para realizar mais. Super indico.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURQMy1LQWdnRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Anna Souzza',
      5,
      'Excelente atendimento! Dra Rita ,está de parabéns, mãos de veludo. Super indico .',
      1743547285374,
      1743547285374,
      'Olá Anna! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":18,"id":"ChdDSUhNMG9nS0VJQ0FnSURQMy1LQWdnRRAB","name":"Anna Souzza","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento! Dra Rita ,está de parabéns, mãos de veludo. Super indico .","ownerResponse":"Olá Anna! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURQeXNPOU9nEAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Jéssica Beus',
      5,
      'A equipe é fantástica! O atendimento foi personalizado, simpático e profissional, uma experiência inesquecível! Recomendo!',
      1743547285374,
      1743547285374,
      'Olá Jessica! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":19,"id":"ChZDSUhNMG9nS0VJQ0FnSURQeXNPOU9nEAE","name":"Jéssica Beus","rating":5,"timeText":"Editado um ano atrás","text":"A equipe é fantástica! O atendimento foi personalizado, simpático e profissional, uma experiência inesquecível! Recomendo!","ownerResponse":"Olá Jessica! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUMzbWJpODFBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Vinicius Vieira',
      5,
      'Local com profissionais excelentes e atendimento impecavel da recepcao. Muito cuidado em todos detalhes!! Recomendo.',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":20,"id":"ChdDSUhNMG9nS0VJQ0FnSUMzbWJpODFBRRAB","name":"Vinicius Vieira","rating":5,"timeText":"um ano atrás","text":"Local com profissionais excelentes e atendimento impecavel da recepcao. Muito cuidado em todos detalhes!! Recomendo.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xkbGNHZ3hZV1pCY1Vkc2JGZFpOVXBETmpBMFdVRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Michi F.',
      5,
      'Excelente atendimento, produtos de qualidade, bons preços, recomendo muito!',
      1756939285374,
      1756939285374,
      'Olá Michi!
Muito obrigado pelo seu carinho e confiança! 💙 Ficamos felizes em saber que você gostou do nosso atendimento, da qualidade dos produtos e dos nossos preços. Trabalhamos todos os dias para oferecer uma experiência completa, segura e acolhedora. Sempre que precisar, estaremos por aqui! ✨',
      1756939285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":21,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xkbGNHZ3hZV1pCY1Vkc2JGZFpOVXBETmpBMFdVRRAB","name":"Michi F.","rating":5,"timeText":"7 meses atrás","text":"Excelente atendimento, produtos de qualidade, bons preços, recomendo muito!","ownerResponse":"Olá Michi!\nMuito obrigado pelo seu carinho e confiança! 💙 Ficamos felizes em saber que você gostou do nosso atendimento, da qualidade dos produtos e dos nossos preços. Trabalhamos todos os dias para oferecer uma experiência completa, segura e acolhedora. Sempre que precisar, estaremos por aqui! ✨"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUMzLXJER19RRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Bruna Bengua',
      5,
      '​Recomendo totalmente! Produtos de qualidade, profissionais muito qualificados e resultados excelentes.',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":22,"id":"ChdDSUhNMG9nS0VJQ0FnSUMzLXJER19RRRAB","name":"Bruna Bengua","rating":5,"timeText":"um ano atrás","text":"​Recomendo totalmente! Produtos de qualidade, profissionais muito qualificados e resultados excelentes.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pOVGRIUkJaa0l4VXpad2QwRldkRTlETTNCb01XYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Priscilla Gomes da costa',
      5,
      'Melhor experiência do mundo, super indico',
      1762123285374,
      1762123285374,
      NULL,
      1762123285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":23,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pOVGRIUkJaa0l4VXpad2QwRldkRTlETTNCb01XYxAB","name":"Priscilla Gomes da costa","rating":5,"timeText":"5 meses atrás","text":"Melhor experiência do mundo, super indico","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNYMjlDUE9nEAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Bárbara Bengua',
      5,
      'Excelente! Equipe muito competente, atenciosa e profissional! Recomendo demais!',
      1743547285374,
      1743547285374,
      'Olá Bárbara! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":24,"id":"ChZDSUhNMG9nS0VJQ0FnSUNYMjlDUE9nEAE","name":"Bárbara Bengua","rating":5,"timeText":"um ano atrás","text":"Excelente! Equipe muito competente, atenciosa e profissional! Recomendo demais!","ownerResponse":"Olá Bárbara! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT214dGMyUXdlV3RKVTFCcFMwMDVNMFpaWTJkeVJHYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Luana e Matheus',
      5,
      '🩷 …',
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":25,"id":"Ci9DQUlRQUNvZENodHljRjlvT214dGMyUXdlV3RKVTFCcFMwMDVNMFpaWTJkeVJHYxAB","name":"Luana e Matheus","rating":5,"timeText":"Editado 4 meses atrás","text":"🩷 …","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNYNWRQb0h3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'rejane garcia da silva',
      5,
      'Fui muito bem atendida com profissionais qualificados 👏 …',
      1743547285374,
      1743547285374,
      'Olá Rejane! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":26,"id":"ChZDSUhNMG9nS0VJQ0FnSUNYNWRQb0h3EAE","name":"rejane garcia da silva","rating":5,"timeText":"um ano atrás","text":"Fui muito bem atendida com profissionais qualificados 👏 …","ownerResponse":"Olá Rejane! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTURncnN2aXlBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Karla oliveira',
      5,
      'Adorei o atendimento da Dra.. super recomendo',
      1743547285374,
      1743547285374,
      'Olá Karla! 🥰
Muito obrigada por sua avaliação 5 estrelas!
Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":27,"id":"ChdDSUhNMG9nS0VJQ0FnTURncnN2aXlBRRAB","name":"Karla oliveira","rating":5,"timeText":"um ano atrás","text":"Adorei o atendimento da Dra.. super recomendo","ownerResponse":"Olá Karla! 🥰\nMuito obrigada por sua avaliação 5 estrelas!\nFicamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEspaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTUNRbWRIWEtBEAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Agatha Machado',
      5,
      'Atendimento excelente! Biomédica atenciosa e cuidadosa.',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":28,"id":"ChZDSUhNMG9nS0VJQ0FnTUNRbWRIWEtBEAE","name":"Agatha Machado","rating":5,"timeText":"um ano atrás","text":"Atendimento excelente! Biomédica atenciosa e cuidadosa.","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNQNXVpWGZ3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Talita Grati mendes',
      5,
      'Fui super bem recebida, simplesmente amei o atendimento',
      1743547285374,
      1743547285374,
      'OláTalita! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":29,"id":"ChZDSUhNMG9nS0VJQ0FnSUNQNXVpWGZ3EAE","name":"Talita Grati mendes","rating":5,"timeText":"um ano atrás","text":"Fui super bem recebida, simplesmente amei o atendimento","ownerResponse":"OláTalita! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25sVFIxaG1hM05QT0MxU2FtUkVNRTlUVVU5WlUzYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Paloma Antonio',
      5,
      'Gostei muito do atendimento!',
      1767307285374,
      1767307285374,
      NULL,
      1767307285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":30,"id":"Ci9DQUlRQUNvZENodHljRjlvT25sVFIxaG1hM05QT0MxU2FtUkVNRTlUVVU5WlUzYxAB","name":"Paloma Antonio","rating":5,"timeText":"3 meses atrás","text":"Gostei muito do atendimento!","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUR2Z2N6MXBBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Luciana Abreu',
      5,
      'Primeira vez é estou amando o meu rosto e boca.',
      1743547285374,
      1743547285374,
      'Olá Luciana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":31,"id":"ChdDSUhNMG9nS0VJQ0FnSUR2Z2N6MXBBRRAB","name":"Luciana Abreu","rating":5,"timeText":"um ano atrás","text":"Primeira vez é estou amando o meu rosto e boca.","ownerResponse":"Olá Luciana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25BM2VYcG9aVTFaUTNkME5XSmlVbUZKWlhGWWNVRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Ivete Vitorino',
      5,
      'Ótimo  ,obrigada ,ótima profissional  agradecida',
      1754347285374,
      1754347285374,
      'Nós que agradecemos pelo carinho e pela confiança! 💙 Ficamos muito felizes em saber que teve uma boa experiência com nossa profissional. 
Olá Ivete!
Estaremos sempre por aqui para te receber com o mesmo cuidado e dedicação! ✨ Até a próxima!',
      1754347285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":32,"id":"Ci9DQUlRQUNvZENodHljRjlvT25BM2VYcG9aVTFaUTNkME5XSmlVbUZKWlhGWWNVRRAB","name":"Ivete Vitorino","rating":5,"timeText":"8 meses atrás","text":"Ótimo  ,obrigada ,ótima profissional  agradecida","ownerResponse":"Nós que agradecemos pelo carinho e pela confiança! 💙 Ficamos muito felizes em saber que teve uma boa experiência com nossa profissional. \nOlá Ivete!\nEstaremos sempre por aqui para te receber com o mesmo cuidado e dedicação! ✨ Até a próxima!"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xSS1FVSmZabGMwUVVKeVRGVktlRlowTVZaSlRXYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Janete Maria',
      5,
      'Ótimo',
      1767307285374,
      1767307285374,
      NULL,
      1767307285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":33,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xSS1FVSmZabGMwUVVKeVRGVktlRlowTVZaSlRXYxAB","name":"Janete Maria","rating":5,"timeText":"3 meses atrás","text":"Ótimo","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzbWJDWkp3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Thiago Pereira Waseluch',
      5,
      'Excelente espaço, profissionais! 👏🏻 …',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":34,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzbWJDWkp3EAE","name":"Thiago Pereira Waseluch","rating":5,"timeText":"um ano atrás","text":"Excelente espaço, profissionais! 👏🏻 …","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTURndjhxdWdnRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Eliane Quanz',
      5,
      'Adorei a Rita!!',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":35,"id":"ChdDSUhNMG9nS0VJQ0FnTURndjhxdWdnRRAB","name":"Eliane Quanz","rating":5,"timeText":"um ano atrás","text":"Adorei a Rita!!","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTURncnV1MWFREAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Lisane Mallet',
      5,
      'Atendimento, competência..',
      1743547285374,
      1743547285374,
      'Olá Lisane! 🥰
Muito obrigada por sua avaliação 5 estrelas!
Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":36,"id":"ChZDSUhNMG9nS0VJQ0FnTURncnV1MWFREAE","name":"Lisane Mallet","rating":5,"timeText":"um ano atrás","text":"Atendimento, competência..","ownerResponse":"Olá Lisane! 🥰\nMuito obrigada por sua avaliação 5 estrelas!\nFicamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEspaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYNWV6VHRBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Nathalia Roos',
      5,
      'Excelente atendimento! 😍 …',
      1743547285374,
      1743547285374,
      'Olá Nathalia! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":37,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYNWV6VHRBRRAB","name":"Nathalia Roos","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento! 😍 …","ownerResponse":"Olá Nathalia! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzbWFqN0ZREAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Thamara Thay',
      5,
      'Ótimo atendimento ❤️',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":38,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzbWFqN0ZREAE","name":"Thamara Thay","rating":5,"timeText":"um ano atrás","text":"Ótimo atendimento ❤️","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzbWEyTUpnEAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Paula Vargas',
      5,
      'Atendimento maravilhoso!!!🥰🥰🥰 …',
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":39,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzbWEyTUpnEAE","name":"Paula Vargas","rating":5,"timeText":"um ano atrás","text":"Atendimento maravilhoso!!!🥰🥰🥰 …","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT20xNFQwdGxkRGQ1UzAxS1puRXhRWGh5WlVsTWFuYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Ju Trindade',
      5,
      'amiiiiii',
      1751755285374,
      1751755285374,
      'Aaaa que alegria ler isso! 🥰 Ficamos muito felizes que você amou! 
Olá Ju!
Estaremos sempre aqui pra te receber com o mesmo carinho 💙✨ Até a próxima! …',
      1751755285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":40,"id":"Ci9DQUlRQUNvZENodHljRjlvT20xNFQwdGxkRGQ1UzAxS1puRXhRWGh5WlVsTWFuYxAB","name":"Ju Trindade","rating":5,"timeText":"9 meses atrás","text":"amiiiiii","ownerResponse":"Aaaa que alegria ler isso! 🥰 Ficamos muito felizes que você amou! \nOlá Ju!\nEstaremos sempre aqui pra te receber com o mesmo carinho 💙✨ Até a próxima! …"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xocGVHcFhXbkZQYUUxcFdXWlVRVEpTVlRodVJFRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'rosane paz machado',
      5,
      NULL,
      1767307285374,
      1767307285374,
      NULL,
      1767307285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":41,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xocGVHcFhXbkZQYUUxcFdXWlVRVEpTVlRodVJFRRAB","name":"rosane paz machado","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT205RldUZFROMGRWYnpGNFdqUmFkbW95UW1oSFlsRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Amanda Hagel',
      5,
      NULL,
      1767307285374,
      1767307285374,
      NULL,
      1767307285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":42,"id":"Ci9DQUlRQUNvZENodHljRjlvT205RldUZFROMGRWYnpGNFdqUmFkbW95UW1oSFlsRRAB","name":"Amanda Hagel","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2swellVaGtNRWN4ZW5ab1NHeGhWRkJxTlRreU4xRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Vanessa Vanessa',
      5,
      NULL,
      1764715285374,
      1764715285374,
      NULL,
      1764715285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":43,"id":"Ci9DQUlRQUNvZENodHljRjlvT2swellVaGtNRWN4ZW5ab1NHeGhWRkJxTlRreU4xRRAB","name":"Vanessa Vanessa","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25aNGFYRjRWRlJYVDFSUVRGTk1VbFZDYlZKVGJIYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'lucimar nunes da silva',
      5,
      NULL,
      1762123285374,
      1762123285374,
      NULL,
      1762123285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":44,"id":"Ci9DQUlRQUNvZENodHljRjlvT25aNGFYRjRWRlJYVDFSUVRGTk1VbFZDYlZKVGJIYxAB","name":"lucimar nunes da silva","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21scVQydERjMUZuY1Y5NVoxaFBNMEZMTUVST1NGRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Dilane- Coord. Cursos Rede Calábria',
      5,
      NULL,
      1762123285374,
      1762123285374,
      NULL,
      1762123285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":45,"id":"Ci9DQUlRQUNvZENodHljRjlvT21scVQydERjMUZuY1Y5NVoxaFBNMEZMTUVST1NGRRAB","name":"Dilane- Coord. Cursos Rede Calábria","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tKNE5VbFdSazVLZEhwUFdVcDRaV2hNVG1VdGVIYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      '´Camila Rodrigues',
      5,
      NULL,
      1759531285374,
      1759531285374,
      NULL,
      1759531285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":46,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tKNE5VbFdSazVLZEhwUFdVcDRaV2hNVG1VdGVIYxAB","name":"´Camila Rodrigues","rating":5,"timeText":"6 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pnMVpFazJRelkwUjBkVFVtTkVhVzFZUVZCcE1tYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Girlene Barros',
      5,
      NULL,
      1756939285374,
      1756939285374,
      NULL,
      1756939285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":47,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pnMVpFazJRelkwUjBkVFVtTkVhVzFZUVZCcE1tYxAB","name":"Girlene Barros","rating":5,"timeText":"7 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT210aWIwTktiVmxVZGpCeVpGUmhhR0pXUm0wM01YYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Elisabeth Konzen',
      5,
      NULL,
      1756939285374,
      1756939285374,
      NULL,
      1756939285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":48,"id":"Ci9DQUlRQUNvZENodHljRjlvT210aWIwTktiVmxVZGpCeVpGUmhhR0pXUm0wM01YYxAB","name":"Elisabeth Konzen","rating":5,"timeText":"7 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2swNFJHSTFRMDFIZWpORFgxcG9XWEpxYkZGVFkzYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Alessandra Taina Pellin',
      5,
      NULL,
      1754347285374,
      1754347285374,
      NULL,
      1754347285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":49,"id":"Ci9DQUlRQUNvZENodHljRjlvT2swNFJHSTFRMDFIZWpORFgxcG9XWEpxYkZGVFkzYxAB","name":"Alessandra Taina Pellin","rating":5,"timeText":"8 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21WZldtdEdhSE5JTjBoSmEzVTVibGxvVDBWNFJuYxAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Cris Masci',
      5,
      NULL,
      1754347285374,
      1754347285374,
      NULL,
      1754347285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":50,"id":"Ci9DQUlRQUNvZENodHljRjlvT21WZldtdEdhSE5JTjBoSmEzVTVibGxvVDBWNFJuYxAB","name":"Cris Masci","rating":5,"timeText":"8 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTUNJalp6UUJ3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'ANA PADILHA',
      5,
      NULL,
      1746571285374,
      1746571285374,
      NULL,
      1746571285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":51,"id":"ChZDSUhNMG9nS0VJQ0FnTUNJalp6UUJ3EAE","name":"ANA PADILHA","rating":5,"timeText":"11 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTUNJcWJyTVJ3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Joice Freitas',
      5,
      NULL,
      1746571285374,
      1746571285374,
      NULL,
      1746571285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":52,"id":"ChZDSUhNMG9nS0VJQ0FnTUNJcWJyTVJ3EAE","name":"Joice Freitas","rating":5,"timeText":"11 meses atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTUN3dXVTcG9BRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'JÚLIA Krause',
      5,
      NULL,
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":53,"id":"ChdDSUhNMG9nS0VJQ0FnTUN3dXVTcG9BRRAB","name":"JÚLIA Krause","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTUNRcl9TMFB3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Elizabet Prates',
      5,
      NULL,
      1743547285374,
      1743547285374,
      NULL,
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":54,"id":"ChZDSUhNMG9nS0VJQ0FnTUNRcl9TMFB3EAE","name":"Elizabet Prates","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":""}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTURnenJqYTZ3RRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Pedro Valentim Brocker',
      5,
      NULL,
      1743547285374,
      1743547285374,
      'Olá Pedro! 🥰
Muito obrigada por sua avaliação 5 estrelas!
Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":55,"id":"ChdDSUhNMG9nS0VJQ0FnTURnenJqYTZ3RRAB","name":"Pedro Valentim Brocker","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Pedro! 🥰\nMuito obrigada por sua avaliação 5 estrelas!\nFicamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEspaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTUNnN19fdG1RRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Pablo D''Avila',
      4,
      NULL,
      1743547285374,
      1743547285374,
      'Olá,Pablo! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.

Além disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.

Esperamos vê-la novamente em breve! 💐',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":56,"id":"ChdDSUhNMG9nS0VJQ0FnTUNnN19fdG1RRRAB","name":"Pablo D''Avila","rating":4,"timeText":"um ano atrás","text":"","ownerResponse":"Olá,Pablo! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.\n\nAlém disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.\n\nEsperamos vê-la novamente em breve! 💐"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTURBdHJ5a2N3EAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Wagner Rodrigues',
      5,
      NULL,
      1743547285374,
      1743547285374,
      'Olá Wagner! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":57,"id":"ChZDSUhNMG9nS0VJQ0FnTURBdHJ5a2N3EAE","name":"Wagner Rodrigues","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Wagner! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURfZ2E2M3JBRRAB',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Ana Paula Henrique Silveira',
      5,
      NULL,
      1743547285374,
      1743547285374,
      'Olá Ana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":58,"id":"ChdDSUhNMG9nS0VJQ0FnSURfZ2E2M3JBRRAB","name":"Ana Paula Henrique Silveira","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Ana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzNDdpckpREAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Nair Ferreira',
      5,
      NULL,
      1743547285374,
      1743547285374,
      'Olá Nair! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":59,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzNDdpckpREAE","name":"Nair Ferreira","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Nair! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNYbGNqektnEAE',
      'barrashoppingsul',
      'ChIJZdhuMFx5GZURql2Gm6xa8LU',
      'Mauricio Benito',
      5,
      NULL,
      1743547285374,
      1743547285374,
      'Olá Mauricio! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547285374,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:41:25.374Z","review":{"index":60,"id":"ChZDSUhNMG9nS0VJQ0FnSUNYbGNqektnEAE","name":"Mauricio Benito","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Mauricio! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592849,
      1775083592849
    );

INSERT INTO gbp_review_sync_runs (
    id, unit_slug, place_id, started_at_ms, finished_at_ms, success, fetched_reviews, error
  ) VALUES (
    'manual_barrashoppingsul_1775083285374',
    'barrashoppingsul',
    'ChIJZdhuMFx5GZURql2Gm6xa8LU',
    1775083285374,
    1775083592849,
    1,
    61,
    NULL
  );

DELETE FROM gbp_reviews WHERE unit_slug = 'novo-hamburgo';

DELETE FROM gbp_review_summaries WHERE unit_slug = 'novo-hamburgo';

DELETE FROM gbp_review_sync_runs WHERE unit_slug = 'novo-hamburgo';

INSERT INTO gbp_review_summaries (
      unit_slug, place_id, gbp_location, location_resource_name,
      average_rating, total_reviews, reviews_synced, synced_at_ms,
      created_at_ms, updated_at_ms
    ) VALUES (
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      '7339519901965290091',
      NULL,
      4.7566,
      152,
      152,
      1775083383948,
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2kxMVZrdzROVTFKUkZoME5sQlRRM1ZaVG5ocWJtYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Aline Silva',
      1,
      'Uma situação que me aconteceu pela segunda vez é fazer o primeiro atendimento  ou avaliação com um profissional e chegar no dia e ser outro e não ser avisada previamente! Aconteceu no meu retoque de botox e na aplicação do meu bioestimulador. Se marquei com um profissional creio que a  prioridade é para o que foi marcado.',
      1772491383948,
      1772491383948,
      NULL,
      1772491383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":0,"id":"Ci9DQUlRQUNvZENodHljRjlvT2kxMVZrdzROVTFKUkZoME5sQlRRM1ZaVG5ocWJtYxAB","name":"Aline Silva","rating":1,"timeText":"um mês atrás","text":"Uma situação que me aconteceu pela segunda vez é fazer o primeiro atendimento  ou avaliação com um profissional e chegar no dia e ser outro e não ser avisada previamente! Aconteceu no meu retoque de botox e na aplicação do meu bioestimulador. Se marquei com um profissional creio que a  prioridade é para o que foi marcado.","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tsR1prcGlhRlV0Um1ZM2JqZzFWbEp2YUZwTk9HYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jéssica Mazilli dos Reis',
      5,
      'Sinto total confiança na equipe. Sempre sou muito bem atendida e os procedimentos ficam ótimos. Nada de exagero e respeitando a anatomia natural do rosto.
Super recomendo que façam os procedimentos com o dr Vinícius. Ele é ótimo.
As fotos em anexo são do pós imediato dos preenchimento labial e de bigode chinês e após 2 horas da realização dos procedimentos.
Obs: o desenho dos meus lábios são naturais e o dr Vinícius seguiu o contorno.',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":1,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tsR1prcGlhRlV0Um1ZM2JqZzFWbEp2YUZwTk9HYxAB","name":"Jéssica Mazilli dos Reis","rating":5,"timeText":"4 meses atrás","text":"Sinto total confiança na equipe. Sempre sou muito bem atendida e os procedimentos ficam ótimos. Nada de exagero e respeitando a anatomia natural do rosto.\nSuper recomendo que façam os procedimentos com o dr Vinícius. Ele é ótimo.\nAs fotos em anexo são do pós imediato dos preenchimento labial e de bigode chinês e após 2 horas da realização dos procedimentos.\nObs: o desenho dos meus lábios são naturais e o dr Vinícius seguiu o contorno.","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tSU09GcFlTMEoxY2xkU1FuTm5hV2xHTTNSaVYzYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Arthemis B',
      1,
      'O atendimento é ótimo, gostei do espaço. Mas infelizmente o botox não durou nem um mês, em outros profissionais que fiz durou bem mais. Fiz preenchimento de malar no começo do ano, em março, coloquei 2ml em cada bochecha, não fez diferença nenhuma. A professional me disse que para fazer uma diferença significativa no meu rosto teria que ser uns 4 ml, e eu pensei que era esse o problema, tanto que nem insisti... Poucos meses depois fui em um profissional de minha confiança, ele analisou o meu rosto e para a minha frustração disse que não havia vestígio nenhum de preenchimento ali. No meu lábio que eu fiz em outro lugar bem antes (final de 2003) ainda havia. Nesse profissional coloquei apenas 1ml e me surpreendi quando vi como havia dado resultado apenas 1ml, bem diferente dos 2ml da espaço facial que não havia dado diferença nenhuma no meu rosto, parece que nada foi aplicado... Vi outros resultados de pessoas que colocaram 1ml (ou até meio ml) no mala em outros profissionais e também dava pra notar e o meu da espaço facial nada, acredito que fui enganada ou o produto era de baixa qualidade. Foi um investimento jogado no lixo, uma pena',
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":2,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tSU09GcFlTMEoxY2xkU1FuTm5hV2xHTTNSaVYzYxAB","name":"Arthemis B","rating":1,"timeText":"5 meses atrás","text":"O atendimento é ótimo, gostei do espaço. Mas infelizmente o botox não durou nem um mês, em outros profissionais que fiz durou bem mais. Fiz preenchimento de malar no começo do ano, em março, coloquei 2ml em cada bochecha, não fez diferença nenhuma. A professional me disse que para fazer uma diferença significativa no meu rosto teria que ser uns 4 ml, e eu pensei que era esse o problema, tanto que nem insisti... Poucos meses depois fui em um profissional de minha confiança, ele analisou o meu rosto e para a minha frustração disse que não havia vestígio nenhum de preenchimento ali. No meu lábio que eu fiz em outro lugar bem antes (final de 2003) ainda havia. Nesse profissional coloquei apenas 1ml e me surpreendi quando vi como havia dado resultado apenas 1ml, bem diferente dos 2ml da espaço facial que não havia dado diferença nenhuma no meu rosto, parece que nada foi aplicado... Vi outros resultados de pessoas que colocaram 1ml (ou até meio ml) no mala em outros profissionais e também dava pra notar e o meu da espaço facial nada, acredito que fui enganada ou o produto era de baixa qualidade. Foi um investimento jogado no lixo, uma pena","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xsUFJrczBkVzlqYmxOcGVEQkNjM2sxZFRWbGIzYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jennifer Colman',
      1,
      'Unidade de NH/RS - Propaganda enganosa e total falta de transparência! Anunciaram botox por R$99 (35UI em até 4x), mas na hora quiseram cobrar o mesmo valor por 20UI e ainda à vista. Tentei entender e só me enrolaram. Até o valor exibido na TV da recepção era diferente! Me senti enganada e desrespeitada. Não recomendo!',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":3,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xsUFJrczBkVzlqYmxOcGVEQkNjM2sxZFRWbGIzYxAB","name":"Jennifer Colman","rating":1,"timeText":"4 meses atrás","text":"Unidade de NH/RS - Propaganda enganosa e total falta de transparência! Anunciaram botox por R$99 (35UI em até 4x), mas na hora quiseram cobrar o mesmo valor por 20UI e ainda à vista. Tentei entender e só me enrolaram. Até o valor exibido na TV da recepção era diferente! Me senti enganada e desrespeitada. Não recomendo!","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT201dGExQldiR1JRYjJoQ2FsUXphbDlpVHpKQ01rRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Vanessa Franco',
      5,
      'Lugar lindo e um ótimo atendimento.
Café maravilhoso',
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":4,"id":"Ci9DQUlRQUNvZENodHljRjlvT201dGExQldiR1JRYjJoQ2FsUXphbDlpVHpKQ01rRRAB","name":"Vanessa Franco","rating":5,"timeText":"5 meses atrás","text":"Lugar lindo e um ótimo atendimento.\nCafé maravilhoso","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2taMlJrbzFkWHA1Y25ORE1sUjRVell0ZDFOS1VHYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Andriza Herasimczuk',
      5,
      'Experiência maravilhosa,  atendimento especial, estou me sentindo confiante, e sei que estou em boas mãos, profissional qualificada e sabe exatamente o que fazer',
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":5,"id":"Ci9DQUlRQUNvZENodHljRjlvT2taMlJrbzFkWHA1Y25ORE1sUjRVell0ZDFOS1VHYxAB","name":"Andriza Herasimczuk","rating":5,"timeText":"Editado 3 meses atrás","text":"Experiência maravilhosa,  atendimento especial, estou me sentindo confiante, e sei que estou em boas mãos, profissional qualificada e sabe exatamente o que fazer","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25CU2R6ZDJTWFoyUzBSUlFuQTNjRVJGZW1oMVNFRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Cristina beckers',
      5,
      'É um lugar maravilhoso, me senti à vontade e super confiante. Atendimento excelente. Ameiii e com certeza voltarei.',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":6,"id":"Ci9DQUlRQUNvZENodHljRjlvT25CU2R6ZDJTWFoyUzBSUlFuQTNjRVJGZW1oMVNFRRAB","name":"Cristina beckers","rating":5,"timeText":"4 meses atrás","text":"É um lugar maravilhoso, me senti à vontade e super confiante. Atendimento excelente. Ameiii e com certeza voltarei.","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xFNU9XTnVhV2xsVG00dFJHMDROak5RYzBoTVZGRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ju M',
      5,
      'Estou amando o atendimento e os procedimentos do Espaço Facial, as meninas cuidando de tudo com muito carinho e empatia!',
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":7,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xFNU9XTnVhV2xsVG00dFJHMDROak5RYzBoTVZGRRAB","name":"Ju M","rating":5,"timeText":"5 meses atrás","text":"Estou amando o atendimento e os procedimentos do Espaço Facial, as meninas cuidando de tudo com muito carinho e empatia!","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2sxQ1JtMXFRMk5DWVVsNVEwaHdlVE53WjJkek0wRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Letícia Provin',
      1,
      'Espaço bonito e bem organizado.  Venda excelente mas decepciona no resultado. O botox dura um mês. Não recomendo. Fui por indicação de uma conhecida  mas não voltarei. Foi mais barato mas não valeu a pena. Pelo pouco tempo foi muito caro. Não recomendo.',
      1754347383948,
      1754347383948,
      'Olá Leticia! Sentimos por não ter atendido suas expectativas. Nosso time indicou um protocolo mais completo, mas entendemos que você optou por uma versão reduzida, conforme registrado no termo de ciência.
A resposta ao tratamento pode variar de pessoa para pessoa, e seguimos sempre com orientações personalizadas para garantir o melhor resultado. Seguimos à disposição caso queira reavaliar conosco 😊',
      1754347383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":8,"id":"Ci9DQUlRQUNvZENodHljRjlvT2sxQ1JtMXFRMk5DWVVsNVEwaHdlVE53WjJkek0wRRAB","name":"Letícia Provin","rating":1,"timeText":"8 meses atrás","text":"Espaço bonito e bem organizado.  Venda excelente mas decepciona no resultado. O botox dura um mês. Não recomendo. Fui por indicação de uma conhecida  mas não voltarei. Foi mais barato mas não valeu a pena. Pelo pouco tempo foi muito caro. Não recomendo.","ownerResponse":"Olá Leticia! Sentimos por não ter atendido suas expectativas. Nosso time indicou um protocolo mais completo, mas entendemos que você optou por uma versão reduzida, conforme registrado no termo de ciência.\nA resposta ao tratamento pode variar de pessoa para pessoa, e seguimos sempre com orientações personalizadas para garantir o melhor resultado. Seguimos à disposição caso queira reavaliar conosco 😊"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT20xbFZGUTRXWHBOTWt4aFNtazFOVEJEY0cxR1pXYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Lucy Souza',
      5,
      'Muito bem recebida e ótimas profissionais
Super recomendo',
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":9,"id":"Ci9DQUlRQUNvZENodHljRjlvT20xbFZGUTRXWHBOTWt4aFNtazFOVEJEY0cxR1pXYxAB","name":"Lucy Souza","rating":5,"timeText":"3 meses atrás","text":"Muito bem recebida e ótimas profissionais\nSuper recomendo","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURYaUlxeF9RRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'K',
      5,
      'Dra Lissana foi perfeita😍 Moro na Austrália e ao ir de férias pro RS não tinha indicação de profissional ou clínica perto da minha cidade. Pesquisei no Google e fui fazer um avaliação sem compromisso e com muita paciência sanou minhas dúvidas, pois eu estava muito insegura e com medo.  A Dra me deixou tranquila durante todo o processo e também foi muito atenciosa e prestativa na na fase de recuperação. Ela é muito segura, e tem razão em ser, pois realizou tudo com perfeição deixando um resultado  super natural, somente para perder aquela face de ‘cansaço’, exatamente como eu buscava. Maravilhosa! Super recomendo!!',
      1743547383948,
      1743547383948,
      'Olá! 🥰 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 💕 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":10,"id":"ChdDSUhNMG9nS0VJQ0FnSURYaUlxeF9RRRAB","name":"K","rating":5,"timeText":"um ano atrás","text":"Dra Lissana foi perfeita😍 Moro na Austrália e ao ir de férias pro RS não tinha indicação de profissional ou clínica perto da minha cidade. Pesquisei no Google e fui fazer um avaliação sem compromisso e com muita paciência sanou minhas dúvidas, pois eu estava muito insegura e com medo.  A Dra me deixou tranquila durante todo o processo e também foi muito atenciosa e prestativa na na fase de recuperação. Ela é muito segura, e tem razão em ser, pois realizou tudo com perfeição deixando um resultado  super natural, somente para perder aquela face de ‘cansaço’, exatamente como eu buscava. Maravilhosa! Super recomendo!!","ownerResponse":"Olá! 🥰 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 💕 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTURJbC1LQVJREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mia',
      3,
      'o atendimento e o espaço é ótimo, entretanto realmente o botox durou menos do que em outros lugares que apliquei, mesmo com todos os cuidados e não tomando sol, em poucas semanas após já dava pra ver que não ia durar, então não compensou',
      1746571383948,
      1746571383948,
      'Olá, agradecemos seu feedback! Ficamos felizes que gostou do atendimento e do espaço. Lamentamos que o Botox não tenha tido a durabilidade esperada. Entre em contato para avaliarmos seu caso e encontrarmos a melhor solução para você. 😊 

https://esfa.co/faleconosco/nh',
      1746571383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":11,"id":"ChZDSUhNMG9nS0VJQ0FnTURJbC1LQVJREAE","name":"Mia","rating":3,"timeText":"11 meses atrás","text":"o atendimento e o espaço é ótimo, entretanto realmente o botox durou menos do que em outros lugares que apliquei, mesmo com todos os cuidados e não tomando sol, em poucas semanas após já dava pra ver que não ia durar, então não compensou","ownerResponse":"Olá, agradecemos seu feedback! Ficamos felizes que gostou do atendimento e do espaço. Lamentamos que o Botox não tenha tido a durabilidade esperada. Entre em contato para avaliarmos seu caso e encontrarmos a melhor solução para você. 😊 \n\nhttps://esfa.co/faleconosco/nh"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURmdDd1WVd3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Caroline Suedeckum',
      1,
      'Traumatizante minha experiência com a Espaço Facial NH. Infelizmente meu preenchimento labial ficou horrível, com vários nódulos enormes e muito inchado, mandei mensagem pra clínica falando sobre o ocorrido e pedindo pra agendar um retorno o quanto antes pois na semana tinha uma formatura, falaram que não tinha, somente com outro profissional e também que era “super normal” estar inchado, então no outro dia desesperada mandei fotos, a partir daí levaram a sério e conseguiram um encaixe com a Dra. Josi, a mesma entrou em contato comigo e me orientou iniciar uma medicação, após  fui até a clínica para revisão e  então remover os nódulos que eram enormes, dra utilizou a hialuronidase mas acabou degradando todo o produto acredito, pois meu lábio superior está como antes do preenchimento e o inferior está ainda maior, sendo que um dos motivos do preenchimento era pra ficar mais proporcional com o lábio inferior. Resumo, investi esse valor pra ficar traumatizada apenas.',
      1743547383948,
      1743547383948,
      'Prezada Caroline,

Agradecemos por compartilhar sua experiência e lamentamos profundamente que sua percepção sobre o procedimento não tenha sido positiva. Prezamos pela qualidade de nossos serviços e feedbacks como o seu são fundamentais para aprimorar nosso atendimento.

Gostaríamos de esclarecer os pontos mencionados em sua avaliação para garantir total transparência:

- A aplicação de botox e preenchimentos é um procedimento rápido, com duração média de 15 a 30 minutos, enquanto as revisões são mais breves. Essa objetividade visa respeitar o tempo do cliente, sem comprometer a qualidade, pois seguimos protocolos rigorosos para garantir segurança e excelência.

- O uso de Hialuronidase foi a solução escolhida para tratar os nódulos relatados e agiu diretamente sobre eles, resolvendo o problema local. No entanto, compreendemos que o desinchaço natural ocorrido após o procedimento pode ter dado a impressão de que todo o produto foi removido, o que não é o caso. A hialuronidase reduziu parcialmente o volume ao redor, mas preservou boa parte do produto original.

- Reações inflamatórias, como a que você relatou, embora desconfortáveis, são consideradas dentro da normalidade. Por isso, orientamos o uso de dexametasona, que resolve cerca de 70% dos casos semelhantes. Entretanto, identificamos que o tratamento não foi seguido conforme recomendado, o que pode ter prolongado o tempo de resolução da inflamação.

- A massagem orientada no consultório, embora breve, é uma etapa importante para o sucesso do procedimento e deve ser continuada em casa. Essa continuidade é essencial para alcançar os melhores resultados, já que o tempo limitado em consultório não é suficiente para efeitos completos.

Desde que fomos procurados, revisamos detalhadamente seu caso. Compreendemos a sua insatisfação e, com o objetivo de reconquistar sua confiança, gostaríamos de oferecer um novo preenchimento labial totalmente gratuito, como forma de reafirmar nosso compromisso com a sua satisfação e de superar suas expectativas! Reforçamos nosso desejo de que nos permita demonstrar nossa dedicação e a excelência dos nossos serviços. Pedimos, ainda, que, caso aceite nossa proposta, reconsidere sua avaliação, pois sua opinião é muito importante para nós e para outros clientes que confiam em nosso trabalho.

Estamos à disposição para esclarecer qualquer dúvida ou agendar seu novo atendimento no momento mais conveniente para você.',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":12,"id":"ChZDSUhNMG9nS0VJQ0FnSURmdDd1WVd3EAE","name":"Caroline Suedeckum","rating":1,"timeText":"um ano atrás","text":"Traumatizante minha experiência com a Espaço Facial NH. Infelizmente meu preenchimento labial ficou horrível, com vários nódulos enormes e muito inchado, mandei mensagem pra clínica falando sobre o ocorrido e pedindo pra agendar um retorno o quanto antes pois na semana tinha uma formatura, falaram que não tinha, somente com outro profissional e também que era “super normal” estar inchado, então no outro dia desesperada mandei fotos, a partir daí levaram a sério e conseguiram um encaixe com a Dra. Josi, a mesma entrou em contato comigo e me orientou iniciar uma medicação, após  fui até a clínica para revisão e  então remover os nódulos que eram enormes, dra utilizou a hialuronidase mas acabou degradando todo o produto acredito, pois meu lábio superior está como antes do preenchimento e o inferior está ainda maior, sendo que um dos motivos do preenchimento era pra ficar mais proporcional com o lábio inferior. Resumo, investi esse valor pra ficar traumatizada apenas.","ownerResponse":"Prezada Caroline,\n\nAgradecemos por compartilhar sua experiência e lamentamos profundamente que sua percepção sobre o procedimento não tenha sido positiva. Prezamos pela qualidade de nossos serviços e feedbacks como o seu são fundamentais para aprimorar nosso atendimento.\n\nGostaríamos de esclarecer os pontos mencionados em sua avaliação para garantir total transparência:\n\n- A aplicação de botox e preenchimentos é um procedimento rápido, com duração média de 15 a 30 minutos, enquanto as revisões são mais breves. Essa objetividade visa respeitar o tempo do cliente, sem comprometer a qualidade, pois seguimos protocolos rigorosos para garantir segurança e excelência.\n\n- O uso de Hialuronidase foi a solução escolhida para tratar os nódulos relatados e agiu diretamente sobre eles, resolvendo o problema local. No entanto, compreendemos que o desinchaço natural ocorrido após o procedimento pode ter dado a impressão de que todo o produto foi removido, o que não é o caso. A hialuronidase reduziu parcialmente o volume ao redor, mas preservou boa parte do produto original.\n\n- Reações inflamatórias, como a que você relatou, embora desconfortáveis, são consideradas dentro da normalidade. Por isso, orientamos o uso de dexametasona, que resolve cerca de 70% dos casos semelhantes. Entretanto, identificamos que o tratamento não foi seguido conforme recomendado, o que pode ter prolongado o tempo de resolução da inflamação.\n\n- A massagem orientada no consultório, embora breve, é uma etapa importante para o sucesso do procedimento e deve ser continuada em casa. Essa continuidade é essencial para alcançar os melhores resultados, já que o tempo limitado em consultório não é suficiente para efeitos completos.\n\nDesde que fomos procurados, revisamos detalhadamente seu caso. Compreendemos a sua insatisfação e, com o objetivo de reconquistar sua confiança, gostaríamos de oferecer um novo preenchimento labial totalmente gratuito, como forma de reafirmar nosso compromisso com a sua satisfação e de superar suas expectativas! Reforçamos nosso desejo de que nos permita demonstrar nossa dedicação e a excelência dos nossos serviços. Pedimos, ainda, que, caso aceite nossa proposta, reconsidere sua avaliação, pois sua opinião é muito importante para nós e para outros clientes que confiam em nosso trabalho.\n\nEstamos à disposição para esclarecer qualquer dúvida ou agendar seu novo atendimento no momento mais conveniente para você."}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnTURvaXVLN1VnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Vivian Dias',
      2,
      'Eles divulgam promoções e chegando lá é quase impossível usar pós sempre tem valor a mais, pontos a mais, etc. Inclusive cobraram pontos de retorno. Informações ruins. Doutora com mão pesada para aplicação de botox. Não recomendo.',
      1746571383948,
      1746571383948,
      'Olá, Vivian! Sentimos muito por não termos alcançado suas expectativas. Prezamos pela clareza nas informações e pela excelência no atendimento.

Agradecemos seu retorno — ele é essencial para evoluirmos.',
      1746571383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":13,"id":"ChZDSUhNMG9nS0VJQ0FnTURvaXVLN1VnEAE","name":"Vivian Dias","rating":2,"timeText":"11 meses atrás","text":"Eles divulgam promoções e chegando lá é quase impossível usar pós sempre tem valor a mais, pontos a mais, etc. Inclusive cobraram pontos de retorno. Informações ruins. Doutora com mão pesada para aplicação de botox. Não recomendo.","ownerResponse":"Olá, Vivian! Sentimos muito por não termos alcançado suas expectativas. Prezamos pela clareza nas informações e pela excelência no atendimento.\n\nAgradecemos seu retorno — ele é essencial para evoluirmos."}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25scWExRmFYM05xVTNkYWJsUkxWelJxVlZSa1RIYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Stefany Vargas',
      5,
      'Estou gostando dos resultados! Ótimo atendimento e espaço',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":14,"id":"Ci9DQUlRQUNvZENodHljRjlvT25scWExRmFYM05xVTNkYWJsUkxWelJxVlZSa1RIYxAB","name":"Stefany Vargas","rating":5,"timeText":"4 meses atrás","text":"Estou gostando dos resultados! Ótimo atendimento e espaço","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNEaWFlbGJ3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Giseli Dreher Fauth',
      5,
      'Clínica com ambiente agradável, atendente atenciosa e tratamento profissional.Super recomendo.',
      1712011383948,
      1712011383948,
      'Agradecemos imensamente seu feedback e ficamos muito felizes em saber que teve uma experiência positiva conosco! É sempre um prazer proporcionar um ambiente agradável, um atendimento atencioso e tratamentos profissionais aos nossos clientes. 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":15,"id":"ChZDSUhNMG9nS0VJQ0FnSUNEaWFlbGJ3EAE","name":"Giseli Dreher Fauth","rating":5,"timeText":"2 anos atrás","text":"Clínica com ambiente agradável, atendente atenciosa e tratamento profissional.Super recomendo.","ownerResponse":"Agradecemos imensamente seu feedback e ficamos muito felizes em saber que teve uma experiência positiva conosco! É sempre um prazer proporcionar um ambiente agradável, um atendimento atencioso e tratamentos profissionais aos nossos clientes. 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21SdE9ESXdkVzFtYW1aV09WVjNUMXB3U1dKRVRWRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Leandra Ferraz de souza',
      5,
      'A Josi eh maravilhosa,  achei q o procedimento fosse mais demorado. Ansiosa pelo resultado',
      1759531383948,
      1759531383948,
      NULL,
      1759531383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":16,"id":"Ci9DQUlRQUNvZENodHljRjlvT21SdE9ESXdkVzFtYW1aV09WVjNUMXB3U1dKRVRWRRAB","name":"Leandra Ferraz de souza","rating":5,"timeText":"6 meses atrás","text":"A Josi eh maravilhosa,  achei q o procedimento fosse mais demorado. Ansiosa pelo resultado","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNYbzlMUmJnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mariana Boni',
      5,
      'Fiz toxina botulínica e preenchimento labial com a Dra Thamiris, ela tem mais de fada e é uma ótima profissional, o resultado ficou incrível!
Todas as meninas do Espaço facial Barra Shopping Sul são maravilhosas!',
      1743547383948,
      1743547383948,
      'Olá Mariana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":17,"id":"ChZDSUhNMG9nS0VJQ0FnSUNYbzlMUmJnEAE","name":"Mariana Boni","rating":5,"timeText":"um ano atrás","text":"Fiz toxina botulínica e preenchimento labial com a Dra Thamiris, ela tem mais de fada e é uma ótima profissional, o resultado ficou incrível!\nTodas as meninas do Espaço facial Barra Shopping Sul são maravilhosas!","ownerResponse":"Olá Mariana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNIbjlIUVNREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Pamela Lima',
      5,
      'A melhor experiência em procedimento facial na minha pele. Desde a recepcao, o atendimento com a Dra Josi, tudo perfeito. Fiquei com a beleza natural e jovial. Ah sem falar dos preços acessíveis e formas de pagamento/parcelamento. Parabéns e sucesso 🙏 …',
      1743547383948,
      1743547383948,
      'Olá Pamela! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":18,"id":"ChZDSUhNMG9nS0VJQ0FnSUNIbjlIUVNREAE","name":"Pamela Lima","rating":5,"timeText":"um ano atrás","text":"A melhor experiência em procedimento facial na minha pele. Desde a recepcao, o atendimento com a Dra Josi, tudo perfeito. Fiquei com a beleza natural e jovial. Ah sem falar dos preços acessíveis e formas de pagamento/parcelamento. Parabéns e sucesso 🙏 …","ownerResponse":"Olá Pamela! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pFd2JFcFhNRVJ4WWxNeVJHeE5iR2t0UVd0WE9WRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ronisa Matzenauer',
      5,
      'Adorei o atendimento, profissional super atenciosa e cuidadosa, super recomendo',
      1756939383948,
      1756939383948,
      NULL,
      1756939383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":19,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pFd2JFcFhNRVJ4WWxNeVJHeE5iR2t0UVd0WE9WRRAB","name":"Ronisa Matzenauer","rating":5,"timeText":"7 meses atrás","text":"Adorei o atendimento, profissional super atenciosa e cuidadosa, super recomendo","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xoeGQwcHFMVFZaTWtVeU1rbExVV3d3VGtJM2VrRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Sonia Gomes',
      5,
      'Espaço vip e uma clínica agradável e o  atendimento muito acolhedor,super índico👏 …',
      1756939383948,
      1756939383948,
      NULL,
      1756939383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":20,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xoeGQwcHFMVFZaTWtVeU1rbExVV3d3VGtJM2VrRRAB","name":"Sonia Gomes","rating":5,"timeText":"7 meses atrás","text":"Espaço vip e uma clínica agradável e o  atendimento muito acolhedor,super índico👏 …","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYNWMySXlnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Natália Tarelli Blauth',
      5,
      'Amei cada detalhe! Desde a chegada fui bem recebida pelas meninas, cafezinho maravilhoso, ficha de anamnese, ambiente lindo e aconchegante! Todas elas muito receptivas e simpáticas! O não doeu nada 😍🙈 tô amando 😍 …',
      1743547383948,
      1743547383948,
      'Olá Natália! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":21,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYNWMySXlnRRAB","name":"Natália Tarelli Blauth","rating":5,"timeText":"um ano atrás","text":"Amei cada detalhe! Desde a chegada fui bem recebida pelas meninas, cafezinho maravilhoso, ficha de anamnese, ambiente lindo e aconchegante! Todas elas muito receptivas e simpáticas! O não doeu nada 😍🙈 tô amando 😍 …","ownerResponse":"Olá Natália! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURmOGNEeEpREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mariela Boufleur dos Santos',
      5,
      'Maravilhosa!! Tudo na medida certinha! A profissional que me atendeu fez exatamente como eu queria! Nota 1000!! Já indiquei para varias pessoas!',
      1743547383948,
      1743547383948,
      'Que alegria receber um feedback tão positivo! ✨ Ficamos felizes em saber que sua experiência foi incrível e que alcançamos exatamente o resultado que você desejava!

Agradecemos muito pela sua recomendação e confiança. Estamos sempre à disposição para te atender com o mesmo carinho e excelência. Até a próxima! 😊💖',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":22,"id":"ChZDSUhNMG9nS0VJQ0FnSURmOGNEeEpREAE","name":"Mariela Boufleur dos Santos","rating":5,"timeText":"um ano atrás","text":"Maravilhosa!! Tudo na medida certinha! A profissional que me atendeu fez exatamente como eu queria! Nota 1000!! Já indiquei para varias pessoas!","ownerResponse":"Que alegria receber um feedback tão positivo! ✨ Ficamos felizes em saber que sua experiência foi incrível e que alcançamos exatamente o resultado que você desejava!\n\nAgradecemos muito pela sua recomendação e confiança. Estamos sempre à disposição para te atender com o mesmo carinho e excelência. Até a próxima! 😊💖"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNqXzVQM3VBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jumajublog Cruz',
      5,
      'O Biomédico Juan, me ajudou muito na decisão do que eu precisava e quais procedimentos melhorariam o aspecto da minha pele de 39 anos, não forçou nenhum procedimento e me deixou a par de valores e facilidade de pagamento me deixando segura com a qualidade dos produtos, que já tinha pesquisado ser muito bons.
Tenho retorno daqui 15 dias e já estou mega satisfeita',
      1743547383948,
      1743547383948,
      'Olá! 🥰
Muito obrigada por sua avaliação de 5 estrelas!   Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,  
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":23,"id":"ChdDSUhNMG9nS0VJQ0FnSUNqXzVQM3VBRRAB","name":"Jumajublog Cruz","rating":5,"timeText":"um ano atrás","text":"O Biomédico Juan, me ajudou muito na decisão do que eu precisava e quais procedimentos melhorariam o aspecto da minha pele de 39 anos, não forçou nenhum procedimento e me deixou a par de valores e facilidade de pagamento me deixando segura com a qualidade dos produtos, que já tinha pesquisado ser muito bons.\nTenho retorno daqui 15 dias e já estou mega satisfeita","ownerResponse":"Olá! 🥰\nMuito obrigada por sua avaliação de 5 estrelas!   Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,  \nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzLXFEdkNREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruna Bengua',
      5,
      '​Profissionais excelentes​ e ​atendimento​ personalizado. Diversidade de procedimentos​, produtos de qualidade e ótimos resultados​. Recomendo muito!',
      1743547383948,
      1743547383948,
      'Olá, Bruna! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":24,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzLXFEdkNREAE","name":"Bruna Bengua","rating":5,"timeText":"um ano atrás","text":"​Profissionais excelentes​ e ​atendimento​ personalizado. Diversidade de procedimentos​, produtos de qualidade e ótimos resultados​. Recomendo muito!","ownerResponse":"Olá, Bruna! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwMmFmeGpRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bárbara Bengua',
      5,
      'Recomendo de olhos fechados! Já fiz diversos procedimentos e todos superaram minhas expectativas. Equipe muito competente e profissional, atenta ao que o cliente quer e muito correta/cuidadosa!',
      1743547383948,
      1743547383948,
      'Olá, Bárbara! 🍃 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 🎯 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":25,"id":"ChdDSUhNMG9nS0VJQ0FnSURwMmFmeGpRRRAB","name":"Bárbara Bengua","rating":5,"timeText":"Editado um ano atrás","text":"Recomendo de olhos fechados! Já fiz diversos procedimentos e todos superaram minhas expectativas. Equipe muito competente e profissional, atenta ao que o cliente quer e muito correta/cuidadosa!","ownerResponse":"Olá, Bárbara! 🍃 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 🎯 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUQ5cjR6b0J3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Annabela Nascimento',
      5,
      'Maravilhosa, a profissional que me atendeu sou muito querida, comunicativa e atenciosa, e sobre o procedimento não senti dor e desconforto, achei tudo maravilhoso 🙏 …',
      1712011383948,
      1712011383948,
      'Annabela, estamos muito gratos pelo seu comentário maravilhoso! 🩷 É ótimo saber que você teve uma experiência positiva conosco, desde o atendimento até o procedimento em si. Nossa equipe se dedica a proporcionar conforto, segurança e os melhores resultados. Ficamos felizes em saber que atendemos às suas expectativas. Se desejar explorar outros tratamentos ou tiver qualquer dúvida, estamos sempre à sua disposição. Esperamos revê-la em breve! 🥰',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":26,"id":"ChZDSUhNMG9nS0VJQ0FnSUQ5cjR6b0J3EAE","name":"Annabela Nascimento","rating":5,"timeText":"2 anos atrás","text":"Maravilhosa, a profissional que me atendeu sou muito querida, comunicativa e atenciosa, e sobre o procedimento não senti dor e desconforto, achei tudo maravilhoso 🙏 …","ownerResponse":"Annabela, estamos muito gratos pelo seu comentário maravilhoso! 🩷 É ótimo saber que você teve uma experiência positiva conosco, desde o atendimento até o procedimento em si. Nossa equipe se dedica a proporcionar conforto, segurança e os melhores resultados. Ficamos felizes em saber que atendemos às suas expectativas. Se desejar explorar outros tratamentos ou tiver qualquer dúvida, estamos sempre à sua disposição. Esperamos revê-la em breve! 🥰"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNuaGNQcHNRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Sílvia C.S. Albano',
      5,
      'Fui muito bem atendida por toda equipe. Dra Rita foi incrível. Agora, só aguardando a produção do colágeno.',
      1743547383948,
      1743547383948,
      'Olá Silvia! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":27,"id":"ChdDSUhNMG9nS0VJQ0FnSUNuaGNQcHNRRRAB","name":"Sílvia C.S. Albano","rating":5,"timeText":"um ano atrás","text":"Fui muito bem atendida por toda equipe. Dra Rita foi incrível. Agora, só aguardando a produção do colágeno.","ownerResponse":"Olá Silvia! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUQzMFBqZmNBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruna H.',
      5,
      'Ótimos preços, produtos de qualidade e profissionais super atenciosos. Ambiente agradável, limpo e acolhedor. Indico de olhos fechados!!',
      1743547383948,
      1743547383948,
      'Olá, Bruna! 🌸 Que bom ouvir que você adorou o atendimento e a nossa atenção pós-procedimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Ficamos felizes em saber que nossa equipe fez a diferença para você. Agradecemos sua recomendação e esperamos continuar superando suas expectativas. 💖 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":28,"id":"ChZDSUhNMG9nS0VJQ0FnSUQzMFBqZmNBEAE","name":"Bruna H.","rating":5,"timeText":"um ano atrás","text":"Ótimos preços, produtos de qualidade e profissionais super atenciosos. Ambiente agradável, limpo e acolhedor. Indico de olhos fechados!!","ownerResponse":"Olá, Bruna! 🌸 Que bom ouvir que você adorou o atendimento e a nossa atenção pós-procedimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Ficamos felizes em saber que nossa equipe fez a diferença para você. Agradecemos sua recomendação e esperamos continuar superando suas expectativas. 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNYNWJpSkdREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Rita Cardoso',
      5,
      'Excelente atendimento e excelente preços! Super atenciosas e as doutoras explicam passo a passo dos procedimentos, recomendo!',
      1743547383948,
      1743547383948,
      'Olá Rita! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":29,"id":"ChZDSUhNMG9nS0VJQ0FnSUNYNWJpSkdREAE","name":"Rita Cardoso","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento e excelente preços! Super atenciosas e as doutoras explicam passo a passo dos procedimentos, recomendo!","ownerResponse":"Olá Rita! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURfNElHTFRREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Grasiela Soares',
      1,
      'Propaganda enganosa.
Lançam promoções de botox, porém o resultado dura 1 mês.  Qualidade péssima.',
      1743547383948,
      1743547383948,
      'Lamentamos profundamente que sua experiência não tenha atendido às suas expectativas. O Botox geralmente tem uma duração média de 3 a 6 meses, dependendo de fatores individuais, como metabolismo, área tratada e cuidados pós-procedimento.

Nosso compromisso é com a qualidade e satisfação dos nossos clientes. Caso tenha enfrentado resultados abaixo do esperado, gostaríamos de entender melhor sua situação e oferecer suporte adequado.',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":30,"id":"ChZDSUhNMG9nS0VJQ0FnSURfNElHTFRREAE","name":"Grasiela Soares","rating":1,"timeText":"um ano atrás","text":"Propaganda enganosa.\nLançam promoções de botox, porém o resultado dura 1 mês.  Qualidade péssima.","ownerResponse":"Lamentamos profundamente que sua experiência não tenha atendido às suas expectativas. O Botox geralmente tem uma duração média de 3 a 6 meses, dependendo de fatores individuais, como metabolismo, área tratada e cuidados pós-procedimento.\n\nNosso compromisso é com a qualidade e satisfação dos nossos clientes. Caso tenha enfrentado resultados abaixo do esperado, gostaríamos de entender melhor sua situação e oferecer suporte adequado."}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNOeXB6TzlnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Life Estúdio de Ginástica e Apoio',
      5,
      'Ótimos profissionais desde a recepção até o profissional que fez o procedimento. Tudo higienizado e espaço muito acolhedor.',
      1712011383948,
      1712011383948,
      'Olá! ☀️ É maravilhoso saber que você teve uma experiência tão positiva em todas as etapas do seu atendimento conosco! Prezamos muito pela excelência, mantendo sempre o foco na higiene e no conforto. Saber que nosso espaço foi acolhedor para você nos deixa extremamente felizes. Agradecemos muito pelo seu feedback e estamos ansiosos para continuar oferecendo experiências que superem suas expectativas. 🤗',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":31,"id":"ChdDSUhNMG9nS0VJQ0FnSUNOeXB6TzlnRRAB","name":"Life Estúdio de Ginástica e Apoio","rating":5,"timeText":"Editado 2 anos atrás","text":"Ótimos profissionais desde a recepção até o profissional que fez o procedimento. Tudo higienizado e espaço muito acolhedor.","ownerResponse":"Olá! ☀️ É maravilhoso saber que você teve uma experiência tão positiva em todas as etapas do seu atendimento conosco! Prezamos muito pela excelência, mantendo sempre o foco na higiene e no conforto. Saber que nosso espaço foi acolhedor para você nos deixa extremamente felizes. Agradecemos muito pelo seu feedback e estamos ansiosos para continuar oferecendo experiências que superem suas expectativas. 🤗"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQzaUxtdnJnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Anny Konrath',
      5,
      'Espaço maravilhoso, lindo mesmo e com pessoal super competente e gentil! Recomendo cem por cento!',
      1743547383948,
      1743547383948,
      'Olá, Anny! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":32,"id":"ChdDSUhNMG9nS0VJQ0FnSUQzaUxtdnJnRRAB","name":"Anny Konrath","rating":5,"timeText":"um ano atrás","text":"Espaço maravilhoso, lindo mesmo e com pessoal super competente e gentil! Recomendo cem por cento!","ownerResponse":"Olá, Anny! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tOamJGWTVSamw1UkVZNFRtMXNPWHBIUkZKYU4zYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Elisangela Agnes',
      5,
      'Ótimo atendimento, procedimento ágil',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":33,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tOamJGWTVSamw1UkVZNFRtMXNPWHBIUkZKYU4zYxAB","name":"Elisangela Agnes","rating":5,"timeText":"4 meses atrás","text":"Ótimo atendimento, procedimento ágil","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNscGNiWU9REAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Estofaria União',
      5,
      'Adorei o atendimento e a atenção mesmo depois do procedimento , perguntando como estou 😍😍😍 simplesmente demais  super recomendo 😊 …',
      1743547383948,
      1743547383948,
      'Olá! 🌸 Que bom ouvir que você adorou o atendimento e a nossa atenção pós-procedimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Ficamos felizes em saber que nossa equipe fez a diferença para você. Agradecemos sua recomendação e esperamos continuar superando suas expectativas. 💖 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":34,"id":"ChZDSUhNMG9nS0VJQ0FnSUNscGNiWU9REAE","name":"Estofaria União","rating":5,"timeText":"Editado um ano atrás","text":"Adorei o atendimento e a atenção mesmo depois do procedimento , perguntando como estou 😍😍😍 simplesmente demais  super recomendo 😊 …","ownerResponse":"Olá! 🌸 Que bom ouvir que você adorou o atendimento e a nossa atenção pós-procedimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Ficamos felizes em saber que nossa equipe fez a diferença para você. Agradecemos sua recomendação e esperamos continuar superando suas expectativas. 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYNWZDcTBBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Thamara Thay',
      5,
      'Ótimo atendimento, as meninas são maravilhosas ❤️❤️❤️ principalmente as da recepção são umas queridas🥰 …',
      1743547383948,
      1743547383948,
      'Olá Thamara! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":35,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYNWZDcTBBRRAB","name":"Thamara Thay","rating":5,"timeText":"um ano atrás","text":"Ótimo atendimento, as meninas são maravilhosas ❤️❤️❤️ principalmente as da recepção são umas queridas🥰 …","ownerResponse":"Olá Thamara! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwbGJpeXpnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Maurício Benito Yagüe',
      5,
      'Olá...realmente faltava uma empresa( clinica) com credibilidade nos produtos e procedimentos.Muito feliz em estar sendo assistido por essa  rede de franquia séria',
      1712011383948,
      1712011383948,
      'Olá, Mauricio! ☀️ Seu feedback nos enche de orgulho! É fundamental para nós trabalhar com produtos e procedimentos de alta credibilidade, e é uma honra saber que isso faz a diferença para você. 🥰 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":36,"id":"ChdDSUhNMG9nS0VJQ0FnSURwbGJpeXpnRRAB","name":"Maurício Benito Yagüe","rating":5,"timeText":"2 anos atrás","text":"Olá...realmente faltava uma empresa( clinica) com credibilidade nos produtos e procedimentos.Muito feliz em estar sendo assistido por essa  rede de franquia séria","ownerResponse":"Olá, Mauricio! ☀️ Seu feedback nos enche de orgulho! É fundamental para nós trabalhar com produtos e procedimentos de alta credibilidade, e é uma honra saber que isso faz a diferença para você. 🥰 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURYOHYydXdnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Michele Andrade',
      5,
      'Atendimento maravilhoso, desde a recepção até o pós procedimentos.',
      1743547383948,
      1743547383948,
      'Olá, Michele! 🌸 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 💕 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":37,"id":"ChdDSUhNMG9nS0VJQ0FnSURYOHYydXdnRRAB","name":"Michele Andrade","rating":5,"timeText":"um ano atrás","text":"Atendimento maravilhoso, desde a recepção até o pós procedimentos.","ownerResponse":"Olá, Michele! 🌸 Muito obrigado por destacar nosso atendimento e serviços. Ficamos extremamente felizes em saber que proporcionamos uma experiência maravilhosa para você. Sua satisfação é nosso maior objetivo! 💕 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMzdUlMMGFBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Angela Maria',
      5,
      'Muito bom atendimento,desde recepção até atendimento da médica , eu recomendo!!!',
      1743547383948,
      1743547383948,
      'Olá Angela! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":38,"id":"ChZDSUhNMG9nS0VJQ0FnSUMzdUlMMGFBEAE","name":"Angela Maria","rating":5,"timeText":"um ano atrás","text":"Muito bom atendimento,desde recepção até atendimento da médica , eu recomendo!!!","ownerResponse":"Olá Angela! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2trNVpuVklOVk5YY1dsdVdVcENjMTlvZGs5VVVHYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Grazi Bade',
      5,
      'Ótimo atendimento, super indico.',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":39,"id":"Ci9DQUlRQUNvZENodHljRjlvT2trNVpuVklOVk5YY1dsdVdVcENjMTlvZGs5VVVHYxAB","name":"Grazi Bade","rating":5,"timeText":"4 meses atrás","text":"Ótimo atendimento, super indico.","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYNTh6aTFnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Anita Metz',
      5,
      'Profissionais super qualificados, limpo, experiência completa e produtos de qualidade!',
      1743547383948,
      1743547383948,
      'Olá Anita! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":40,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYNTh6aTFnRRAB","name":"Anita Metz","rating":5,"timeText":"um ano atrás","text":"Profissionais super qualificados, limpo, experiência completa e produtos de qualidade!","ownerResponse":"Olá Anita! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNsbTZtb2NnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Magda Henriques',
      5,
      'Profissional MT atenciosa e competente.Foi me passando segurança através de explico e delicadeza em aplicar método.ABR',
      1712011383948,
      1712011383948,
      'Magda, agradecemos imensamente suas palavras gentis. 🥰 Ficamos muito felizes em saber que a atenção e competência de nossa equipe proporcionaram a você uma experiência segura e agradável. Na Espaço Facial, valorizamos a comunicação clara e a delicadeza em cada procedimento, garantindo que nossos clientes recebam o melhor em harmonização facial e tratamentos estéticos. 🌸 Sua satisfação e confiança são nossa maior recompensa. Esperamos vê-la novamente em breve para mais experiências positivas! 💕',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":41,"id":"ChZDSUhNMG9nS0VJQ0FnSUNsbTZtb2NnEAE","name":"Magda Henriques","rating":5,"timeText":"2 anos atrás","text":"Profissional MT atenciosa e competente.Foi me passando segurança através de explico e delicadeza em aplicar método.ABR","ownerResponse":"Magda, agradecemos imensamente suas palavras gentis. 🥰 Ficamos muito felizes em saber que a atenção e competência de nossa equipe proporcionaram a você uma experiência segura e agradável. Na Espaço Facial, valorizamos a comunicação clara e a delicadeza em cada procedimento, garantindo que nossos clientes recebam o melhor em harmonização facial e tratamentos estéticos. 🌸 Sua satisfação e confiança são nossa maior recompensa. Esperamos vê-la novamente em breve para mais experiências positivas! 💕"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNILTgzdndnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'raquel gonçalves',
      5,
      'Protocolo sempre executado com sucesso!!
Realizando sempre pela melhor Dra.Lissana 😊 …',
      1743547383948,
      1743547383948,
      'Olá Raquel! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":42,"id":"ChdDSUhNMG9nS0VJQ0FnSUNILTgzdndnRRAB","name":"raquel gonçalves","rating":5,"timeText":"um ano atrás","text":"Protocolo sempre executado com sucesso!!\nRealizando sempre pela melhor Dra.Lissana 😊 …","ownerResponse":"Olá Raquel! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURIcWR1d3pnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Claudia Inacio',
      5,
      'Clínica maravilhosa! Profissionais atenciosos e capacitados!! Super indico!',
      1743547383948,
      1743547383948,
      'Olá Claudia! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":43,"id":"ChdDSUhNMG9nS0VJQ0FnSURIcWR1d3pnRRAB","name":"Claudia Inacio","rating":5,"timeText":"um ano atrás","text":"Clínica maravilhosa! Profissionais atenciosos e capacitados!! Super indico!","ownerResponse":"Olá Claudia! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURqNklXQWFnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Fabricio Oyarzabal',
      5,
      'Ruan e a recepcionista muito atenciosos. Me tirou todas dúvidas, super recomendo.',
      1743547383948,
      1743547383948,
      'Olá Fabricio 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":44,"id":"ChZDSUhNMG9nS0VJQ0FnSURqNklXQWFnEAE","name":"Fabricio Oyarzabal","rating":5,"timeText":"um ano atrás","text":"Ruan e a recepcionista muito atenciosos. Me tirou todas dúvidas, super recomendo.","ownerResponse":"Olá Fabricio 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUR2X3NhSmxnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Margaret Pimentel Santejano Tonel',
      5,
      'Muito bom , espaço acolhedor, recepção calorosa e alegre.',
      1743547383948,
      1743547383948,
      'Que lindo feedback! ✨ Nosso objetivo é proporcionar não apenas excelentes resultados, mas também um ambiente acolhedor para você se sentir especial.

Agradecemos sua confiança e esperamos te receber novamente em breve! 😊💖',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":45,"id":"ChdDSUhNMG9nS0VJQ0FnSUR2X3NhSmxnRRAB","name":"Margaret Pimentel Santejano Tonel","rating":5,"timeText":"um ano atrás","text":"Muito bom , espaço acolhedor, recepção calorosa e alegre.","ownerResponse":"Que lindo feedback! ✨ Nosso objetivo é proporcionar não apenas excelentes resultados, mas também um ambiente acolhedor para você se sentir especial.\n\nAgradecemos sua confiança e esperamos te receber novamente em breve! 😊💖"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURENDZHYmt3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Andréa Cavalheiro',
      5,
      'Achei incrível tudo!
O espaço, a recepção das meninas, o atendendo do Tobias e as explicações dele!!!
Nota 10!!!!',
      1743547383948,
      1743547383948,
      'Que maravilha receber uma avaliação tão positiva, Andréa! 🌟 Agradecemos imensamente pelo seu feedback e ficamos felizes que tenha apreciado tanto a experiência na Espaço Facial, desde nosso ambiente até o atendimento personalizado.

Lembre-se que estamos sempre à disposição para qualquer esclarecimento ou para agendar novos procedimentos. 🌼',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":46,"id":"ChdDSUhNMG9nS0VJQ0FnSURENDZHYmt3RRAB","name":"Andréa Cavalheiro","rating":5,"timeText":"um ano atrás","text":"Achei incrível tudo!\nO espaço, a recepção das meninas, o atendendo do Tobias e as explicações dele!!!\nNota 10!!!!","ownerResponse":"Que maravilha receber uma avaliação tão positiva, Andréa! 🌟 Agradecemos imensamente pelo seu feedback e ficamos felizes que tenha apreciado tanto a experiência na Espaço Facial, desde nosso ambiente até o atendimento personalizado.\n\nLembre-se que estamos sempre à disposição para qualquer esclarecimento ou para agendar novos procedimentos. 🌼"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2t0bWN6Uk1VMkZyU1dSMmIwOXpXVGhxVEcxa1dIYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Marli Rodrigues',
      5,
      'Muito boa',
      1759531383948,
      1759531383948,
      NULL,
      1759531383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":47,"id":"Ci9DQUlRQUNvZENodHljRjlvT2t0bWN6Uk1VMkZyU1dSMmIwOXpXVGhxVEcxa1dIYxAB","name":"Marli Rodrigues","rating":5,"timeText":"6 meses atrás","text":"Muito boa","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21sTFMwUnJWbEYzV2xkMVMyVlhXR2RxWkdkRmJWRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'adriana souza',
      5,
      'Amei!',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":48,"id":"Ci9DQUlRQUNvZENodHljRjlvT21sTFMwUnJWbEYzV2xkMVMyVlhXR2RxWkdkRmJWRRAB","name":"adriana souza","rating":5,"timeText":"4 meses atrás","text":"Amei!","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwMmRQYURnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'rejane garcia da silva',
      5,
      'Adorei os procedimentos feito pelos profissionais da Espaço Facial, fiz botox e peeling',
      1712011383948,
      1712011383948,
      'Olá, Rejane! 🌼 Que bom saber que você adorou os procedimentos! É uma alegria para nós que você tenha tido uma experiência positiva com os seus tratamentos. Fique à vontade para retornar sempre que desejar. 🤩 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":49,"id":"ChZDSUhNMG9nS0VJQ0FnSURwMmRQYURnEAE","name":"rejane garcia da silva","rating":5,"timeText":"Editado 2 anos atrás","text":"Adorei os procedimentos feito pelos profissionais da Espaço Facial, fiz botox e peeling","ownerResponse":"Olá, Rejane! 🌼 Que bom saber que você adorou os procedimentos! É uma alegria para nós que você tenha tido uma experiência positiva com os seus tratamentos. Fique à vontade para retornar sempre que desejar. 🤩 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwNWRfMG5nRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Félix Rafael Benito',
      5,
      'Lugar maravilhoso, atendimento top e serviço melhor ainda. Entrega tudo e um pouco mais.',
      1712011383948,
      1712011383948,
      'Olá, Félix! 😊 Que alegria ler seu comentário! Nossa missão é justamente superar as expectativas e entregar o melhor para nossos clientes. Agradecemos a confiança e o carinho! 🙌  …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":50,"id":"ChdDSUhNMG9nS0VJQ0FnSURwNWRfMG5nRRAB","name":"Félix Rafael Benito","rating":5,"timeText":"2 anos atrás","text":"Lugar maravilhoso, atendimento top e serviço melhor ainda. Entrega tudo e um pouco mais.","ownerResponse":"Olá, Félix! 😊 Que alegria ler seu comentário! Nossa missão é justamente superar as expectativas e entregar o melhor para nossos clientes. Agradecemos a confiança e o carinho! 🙌  …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURweGJ5OWFnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Lissana Campana',
      5,
      'Aqui na Espaço, o ambiente é aconchegante e a equipe está de parabéns!!! Os produtos são os melhores!!',
      1712011383948,
      1712011383948,
      'Olá, Lissana! 🌟 Ficamos encantados com seu feedback! É uma alegria saber que você aprecia nosso ambiente e reconhece a qualidade dos nossos produtos. Toda a equipe agradece suas palavras! 🍃 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":51,"id":"ChZDSUhNMG9nS0VJQ0FnSURweGJ5OWFnEAE","name":"Lissana Campana","rating":5,"timeText":"2 anos atrás","text":"Aqui na Espaço, o ambiente é aconchegante e a equipe está de parabéns!!! Os produtos são os melhores!!","ownerResponse":"Olá, Lissana! 🌟 Ficamos encantados com seu feedback! É uma alegria saber que você aprecia nosso ambiente e reconhece a qualidade dos nossos produtos. Toda a equipe agradece suas palavras! 🍃 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwcGVUZFNBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'vinicius vieira',
      5,
      'Local bonito, com profissionais experientes e utilizam materiais de qualidade! Recomendo.',
      1712011383948,
      1712011383948,
      'Olá, Vinícius! 🍂 Muito obrigado por destacar nossa equipe e os materiais de qualidade que usamos. Sua satisfação é o que nos impulsiona a seguir adiante! 🌹 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":52,"id":"ChZDSUhNMG9nS0VJQ0FnSURwcGVUZFNBEAE","name":"vinicius vieira","rating":5,"timeText":"2 anos atrás","text":"Local bonito, com profissionais experientes e utilizam materiais de qualidade! Recomendo.","ownerResponse":"Olá, Vinícius! 🍂 Muito obrigado por destacar nossa equipe e os materiais de qualidade que usamos. Sua satisfação é o que nos impulsiona a seguir adiante! 🌹 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21WZlZuSnhZekEzZGw5VFVqSkZSM0V4VUd0MWEwRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Raphaela Peixoto',
      5,
      'Maravilhoso voltarei sempre',
      1772491383948,
      1772491383948,
      NULL,
      1772491383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":53,"id":"Ci9DQUlRQUNvZENodHljRjlvT21WZlZuSnhZekEzZGw5VFVqSkZSM0V4VUd0MWEwRRAB","name":"Raphaela Peixoto","rating":5,"timeText":"um mês atrás","text":"Maravilhoso voltarei sempre","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNsMjl6Rmp3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'fabricio klaus',
      5,
      'Ótimo atendimento .Amei o procedimento,super recomendo.',
      1712011383948,
      1712011383948,
      'Olá, Fabrício! ☀️ Agradecemos pelas 5 estrelas e por suas palavras gentis! Ficamos extremamente felizes em saber que você amou o procedimento e teve uma ótima experiência com nosso atendimento. 🌷 Na Espaço Facial, nos dedicamos a oferecer tratamentos de alta qualidade em harmonização facial e corporal, sempre visando a satisfação plena de nossos clientes. Agradecemos a recomendação e esperamos recebê-lo novamente para mais procedimentos que superem suas expectativas.🌟',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":54,"id":"ChdDSUhNMG9nS0VJQ0FnSUNsMjl6Rmp3RRAB","name":"fabricio klaus","rating":5,"timeText":"2 anos atrás","text":"Ótimo atendimento .Amei o procedimento,super recomendo.","ownerResponse":"Olá, Fabrício! ☀️ Agradecemos pelas 5 estrelas e por suas palavras gentis! Ficamos extremamente felizes em saber que você amou o procedimento e teve uma ótima experiência com nosso atendimento. 🌷 Na Espaço Facial, nos dedicamos a oferecer tratamentos de alta qualidade em harmonização facial e corporal, sempre visando a satisfação plena de nossos clientes. Agradecemos a recomendação e esperamos recebê-lo novamente para mais procedimentos que superem suas expectativas.🌟"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNscnRycVBBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Tatiana Assis',
      5,
      'Atendimento maravilhoso e super cuidadosos e pacientes.☺️',
      1712011383948,
      1712011383948,
      'Olá, Tatiana! 🌷 Ficamos imensamente gratos por sua avaliação e por destacar nosso atendimento. É sempre nosso objetivo proporcionar uma experiência maravilhosa! Seu feedback é uma valiosa motivação para continuarmos aprimorando nossos serviços. Esperamos revê-la em breve! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":55,"id":"ChZDSUhNMG9nS0VJQ0FnSUNscnRycVBBEAE","name":"Tatiana Assis","rating":5,"timeText":"2 anos atrás","text":"Atendimento maravilhoso e super cuidadosos e pacientes.☺️","ownerResponse":"Olá, Tatiana! 🌷 Ficamos imensamente gratos por sua avaliação e por destacar nosso atendimento. É sempre nosso objetivo proporcionar uma experiência maravilhosa! Seu feedback é uma valiosa motivação para continuarmos aprimorando nossos serviços. Esperamos revê-la em breve! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUREX0ktSFh3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Liandra Duarte',
      5,
      'Muito bem atendida, profissionais excelentes',
      1743547383948,
      1743547383948,
      'Olá, Liandra! Agradecemos pela sua avaliação de 5 estrelas!  Ficamos muito contentes em saber que você se sentiu bem atendida e que considerou nossos profissionais excelentes. 🌟

É sempre nosso objetivo proporcionar um serviço de alta qualidade com um atendimento personalizado e profissional. Seu feedback é uma confirmação de que estamos no caminho certo! 🌺

Se tiver alguma dúvida ou desejar agendar um novo procedimento, não hesite em nos contatar! 🌼',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":56,"id":"ChZDSUhNMG9nS0VJQ0FnSUREX0ktSFh3EAE","name":"Liandra Duarte","rating":5,"timeText":"um ano atrás","text":"Muito bem atendida, profissionais excelentes","ownerResponse":"Olá, Liandra! Agradecemos pela sua avaliação de 5 estrelas!  Ficamos muito contentes em saber que você se sentiu bem atendida e que considerou nossos profissionais excelentes. 🌟\n\nÉ sempre nosso objetivo proporcionar um serviço de alta qualidade com um atendimento personalizado e profissional. Seu feedback é uma confirmação de que estamos no caminho certo! 🌺\n\nSe tiver alguma dúvida ou desejar agendar um novo procedimento, não hesite em nos contatar! 🌼"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNyNmQ3YURREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Andrea Dorneles Moraes',
      5,
      'Retornei, pois o resultado da primeira vez foi maravilhoso.',
      1743547383948,
      1743547383948,
      'Olá Andrea! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":57,"id":"ChZDSUhNMG9nS0VJQ0FnSUNyNmQ3YURREAE","name":"Andrea Dorneles Moraes","rating":5,"timeText":"Editado um ano atrás","text":"Retornei, pois o resultado da primeira vez foi maravilhoso.","ownerResponse":"Olá Andrea! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNfMWFucXlBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Gabrielly Presser',
      5,
      'Ótima experiência! Atendimento de excelência!',
      1743547383948,
      1743547383948,
      'Ficamos imensamente felizes com seu feedback! ✨ Nosso objetivo é sempre oferecer o melhor atendimento e resultados. Agradecemos sua confiança e esperamos te ver em breve! 💖😊 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":58,"id":"ChdDSUhNMG9nS0VJQ0FnSUNfMWFucXlBRRAB","name":"Gabrielly Presser","rating":5,"timeText":"um ano atrás","text":"Ótima experiência! Atendimento de excelência!","ownerResponse":"Ficamos imensamente felizes com seu feedback! ✨ Nosso objetivo é sempre oferecer o melhor atendimento e resultados. Agradecemos sua confiança e esperamos te ver em breve! 💖😊 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNsMjl6aEl3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Catia Machado',
      5,
      'Me senti acolhida e satisfeita com o procedimento.',
      1712011383948,
      1712011383948,
      'Olá Catia, agradecemos de coração suas 5 estrelas e por compartilhar sua experiência positiva conosco na Espaço Facial. É uma alegria imensa saber que se sentiu acolhida e satisfeita com o procedimento realizado. Nosso objetivo é sempre proporcionar um ambiente acolhedor e tratamentos eficazes em harmonização facial e corporal, para que cada cliente se sinta especial e plenamente satisfeito. 🌹 Ficamos ansiosos pela sua próxima visita e agradecemos por escolher a Espaço Facial para cuidar de sua beleza e bem-estar. 💖',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":59,"id":"ChZDSUhNMG9nS0VJQ0FnSUNsMjl6aEl3EAE","name":"Catia Machado","rating":5,"timeText":"2 anos atrás","text":"Me senti acolhida e satisfeita com o procedimento.","ownerResponse":"Olá Catia, agradecemos de coração suas 5 estrelas e por compartilhar sua experiência positiva conosco na Espaço Facial. É uma alegria imensa saber que se sentiu acolhida e satisfeita com o procedimento realizado. Nosso objetivo é sempre proporcionar um ambiente acolhedor e tratamentos eficazes em harmonização facial e corporal, para que cada cliente se sinta especial e plenamente satisfeito. 🌹 Ficamos ansiosos pela sua próxima visita e agradecemos por escolher a Espaço Facial para cuidar de sua beleza e bem-estar. 💖"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURsb3NMYThnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Gabriel Binello',
      4,
      'Foi legal nem doeu achei bem rapidinho',
      1712011383948,
      1712011383948,
      'Olá, Trent! 👋 Agradecemos por destacar que sua experiência conosco foi agradável e confortável! Seu feedback é crucial para nós, e gostaríamos de saber se há algo que poderíamos fazer para tornar sua experiência ainda melhor. 💖 Se considerar adequado, ficaríamos honrados com uma revisão da sua avaliação para 5 estrelas, refletindo um serviço que atendeu completamente às suas expectativas. Conte conosco para qualquer esclarecimento ou necessidade futura! 🌟',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":60,"id":"ChdDSUhNMG9nS0VJQ0FnSURsb3NMYThnRRAB","name":"Gabriel Binello","rating":4,"timeText":"2 anos atrás","text":"Foi legal nem doeu achei bem rapidinho","ownerResponse":"Olá, Trent! 👋 Agradecemos por destacar que sua experiência conosco foi agradável e confortável! Seu feedback é crucial para nós, e gostaríamos de saber se há algo que poderíamos fazer para tornar sua experiência ainda melhor. 💖 Se considerar adequado, ficaríamos honrados com uma revisão da sua avaliação para 5 estrelas, refletindo um serviço que atendeu completamente às suas expectativas. Conte conosco para qualquer esclarecimento ou necessidade futura! 🌟"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwaFlfbzNnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Vinho Premium',
      5,
      'Merece 5 estrelas. Atendimento perfeito',
      1712011383948,
      1712011383948,
      'Olá, Vinho Premium! 🍷 Foi um prazer ter a parceria de vocês em nosso evento. A qualidade dos seus produtos certamente adicionou um toque especial à ocasião. Aguardamos futuras colaborações! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":61,"id":"ChdDSUhNMG9nS0VJQ0FnSURwaFlfbzNnRRAB","name":"Vinho Premium","rating":5,"timeText":"2 anos atrás","text":"Merece 5 estrelas. Atendimento perfeito","ownerResponse":"Olá, Vinho Premium! 🍷 Foi um prazer ter a parceria de vocês em nosso evento. A qualidade dos seus produtos certamente adicionou um toque especial à ocasião. Aguardamos futuras colaborações! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURGX3NPWldnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Carol',
      5,
      'Excelente local, acolhedor.  Profissional ótima.',
      1712011383948,
      1712011383948,
      'Olá Carol! ☀️ Agradecemos profundamente por reconhecer o ambiente acolhedor e a qualidade dos nossos profissionais. É um prazer saber que proporcionamos uma experiência excelente para você. Esperamos recebê-la novamente em breve! 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":62,"id":"ChZDSUhNMG9nS0VJQ0FnSURGX3NPWldnEAE","name":"Carol","rating":5,"timeText":"2 anos atrás","text":"Excelente local, acolhedor.  Profissional ótima.","ownerResponse":"Olá Carol! ☀️ Agradecemos profundamente por reconhecer o ambiente acolhedor e a qualidade dos nossos profissionais. É um prazer saber que proporcionamos uma experiência excelente para você. Esperamos recebê-la novamente em breve! 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNWOUtXd093EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Patricia Grings',
      5,
      'Ótimo atendimento, profissionais maravilhosas.',
      1712011383948,
      1712011383948,
      'Olá, Patricia! 🌷 Agradecemos imensamente o seu feedback positivo! É uma grande satisfação saber que você teve uma experiência maravilhosa conosco na Espaço Facial. Nosso time de profissionais se dedica a oferecer um atendimento de excelência, aliado a técnicas avançadas em harmonização facial e corporal. Ficamos contentes em ter atendido às suas expectativas e esperamos recebê-la novamente em breve para mais experiências incríveis. 🌟',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":63,"id":"ChZDSUhNMG9nS0VJQ0FnSUNWOUtXd093EAE","name":"Patricia Grings","rating":5,"timeText":"2 anos atrás","text":"Ótimo atendimento, profissionais maravilhosas.","ownerResponse":"Olá, Patricia! 🌷 Agradecemos imensamente o seu feedback positivo! É uma grande satisfação saber que você teve uma experiência maravilhosa conosco na Espaço Facial. Nosso time de profissionais se dedica a oferecer um atendimento de excelência, aliado a técnicas avançadas em harmonização facial e corporal. Ficamos contentes em ter atendido às suas expectativas e esperamos recebê-la novamente em breve para mais experiências incríveis. 🌟"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21Sc1ExbERSMTloWW00NWMySm1WemhGY1ZOR1RXYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Espaço Energia',
      5,
      'Ótimo atendimento !',
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":64,"id":"Ci9DQUlRQUNvZENodHljRjlvT21Sc1ExbERSMTloWW00NWMySm1WemhGY1ZOR1RXYxAB","name":"Espaço Energia","rating":5,"timeText":"4 meses atrás","text":"Ótimo atendimento !","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURMdmJDcWtRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Juliana Lima',
      5,
      'Bem agradável. Atendimento de excelência.',
      1743547383948,
      1743547383948,
      'Olá Juliana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":65,"id":"ChdDSUhNMG9nS0VJQ0FnSURMdmJDcWtRRRAB","name":"Juliana Lima","rating":5,"timeText":"um ano atrás","text":"Bem agradável. Atendimento de excelência.","ownerResponse":"Olá Juliana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwaFpIM3d3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Vanessa Zorgi',
      5,
      'Atendimento maravilhoso e ambiente acolhedor <3',
      1712011383948,
      1712011383948,
      'Olá, Vanessa! 💐 Que felicidade ler seu comentário! Ficamos extremamente contentes em saber que nosso ambiente e atendimento te proporcionaram uma experiência tão positiva. Aguardamos sua próxima visita com entusiasmo! 🩷 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":66,"id":"ChdDSUhNMG9nS0VJQ0FnSURwaFpIM3d3RRAB","name":"Vanessa Zorgi","rating":5,"timeText":"2 anos atrás","text":"Atendimento maravilhoso e ambiente acolhedor <3","ownerResponse":"Olá, Vanessa! 💐 Que felicidade ler seu comentário! Ficamos extremamente contentes em saber que nosso ambiente e atendimento te proporcionaram uma experiência tão positiva. Aguardamos sua próxima visita com entusiasmo! 🩷 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNid2VDUjhRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Eliana Rech',
      5,
      'Excelente atendimento e ambiente  MT agradável',
      1743547383948,
      1743547383948,
      'Olá Eliana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":67,"id":"ChdDSUhNMG9nS0VJQ0FnSUNid2VDUjhRRRAB","name":"Eliana Rech","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento e ambiente  MT agradável","ownerResponse":"Olá Eliana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwdWVqUUZnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Deise D''avila',
      5,
      'Espaço aconchegante e profissionais qualificados.',
      1712011383948,
      1712011383948,
      'Olá, Deise! 🌸 Ficamos contentes em saber que nosso espaço te proporcionou aconchego e que nossos profissionais atenderam às suas expectativas. É uma alegria para nós receber esse feedback tão positivo! 🥰 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":68,"id":"ChZDSUhNMG9nS0VJQ0FnSURwdWVqUUZnEAE","name":"Deise D''avila","rating":5,"timeText":"2 anos atrás","text":"Espaço aconchegante e profissionais qualificados.","ownerResponse":"Olá, Deise! 🌸 Ficamos contentes em saber que nosso espaço te proporcionou aconchego e que nossos profissionais atenderam às suas expectativas. É uma alegria para nós receber esse feedback tão positivo! 🥰 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNYNWNpdjNnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Luiz Felipe Soares',
      5,
      'Excelente atendimento e ótimo trabalho',
      1743547383948,
      1743547383948,
      'Olá Luiz Felipe! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":69,"id":"ChdDSUhNMG9nS0VJQ0FnSUNYNWNpdjNnRRAB","name":"Luiz Felipe Soares","rating":5,"timeText":"um ano atrás","text":"Excelente atendimento e ótimo trabalho","ownerResponse":"Olá Luiz Felipe! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQ1bXF5NWlnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Maria Inês',
      5,
      'Excelente atendimento.
Todas minhas dúvidas foram resolvidas',
      1712011383948,
      1712011383948,
      'Olá, Maria Inês! 🌹 Ficamos muito contentes em saber que pudemos resolver todas as suas dúvidas e oferecer um atendimento à altura de suas expectativas. Sua satisfação é nossa prioridade! Agradecemos pela avaliação positiva e esperamos vê-la em breve! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":70,"id":"ChdDSUhNMG9nS0VJQ0FnSUQ1bXF5NWlnRRAB","name":"Maria Inês","rating":5,"timeText":"2 anos atrás","text":"Excelente atendimento.\nTodas minhas dúvidas foram resolvidas","ownerResponse":"Olá, Maria Inês! 🌹 Ficamos muito contentes em saber que pudemos resolver todas as suas dúvidas e oferecer um atendimento à altura de suas expectativas. Sua satisfação é nossa prioridade! Agradecemos pela avaliação positiva e esperamos vê-la em breve! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNadW9XeXBnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Lucia Fleck',
      5,
      'Lugar maravilhoso, atendimento top, recomendo.',
      1712011383948,
      1712011383948,
      'Olá, Lucia! 🤩 Ficamos extremamente gratos pela sua avaliação! É uma alegria saber que você teve uma experiência maravilhosa conosco. Nossa equipe se esforça diariamente para oferecer o melhor atendimento e sua recomendação é o reconhecimento disso. 🌺 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":71,"id":"ChdDSUhNMG9nS0VJQ0FnSUNadW9XeXBnRRAB","name":"Lucia Fleck","rating":5,"timeText":"2 anos atrás","text":"Lugar maravilhoso, atendimento top, recomendo.","ownerResponse":"Olá, Lucia! 🤩 Ficamos extremamente gratos pela sua avaliação! É uma alegria saber que você teve uma experiência maravilhosa conosco. Nossa equipe se esforça diariamente para oferecer o melhor atendimento e sua recomendação é o reconhecimento disso. 🌺 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwamZiY2l3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'EUZEBIO MARCELLO',
      5,
      'Espaço maravilhoso!! Profissionais e atendimento de primeiro mundo!! 👏👏👏👏👏👏👏👏👏👏👏 …',
      1712011383948,
      1712011383948,
      'Olá, Euzebio! 🌟 Que alegria ler seu comentário! Nosso time se dedica com todo o coração para oferecer um espaço e atendimento de excelência. Agradecemos a confiança e o reconhecimento! 🙏 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":72,"id":"ChdDSUhNMG9nS0VJQ0FnSURwamZiY2l3RRAB","name":"EUZEBIO MARCELLO","rating":5,"timeText":"2 anos atrás","text":"Espaço maravilhoso!! Profissionais e atendimento de primeiro mundo!! 👏👏👏👏👏👏👏👏👏👏👏 …","ownerResponse":"Olá, Euzebio! 🌟 Que alegria ler seu comentário! Nosso time se dedica com todo o coração para oferecer um espaço e atendimento de excelência. Agradecemos a confiança e o reconhecimento! 🙏 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUQzckotb05nEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Graciele Nonemmaker',
      5,
      'Ótima',
      1743547383948,
      1743547383948,
      'Olá, Graciele! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":73,"id":"ChZDSUhNMG9nS0VJQ0FnSUQzckotb05nEAE","name":"Graciele Nonemmaker","rating":5,"timeText":"um ano atrás","text":"Ótima","ownerResponse":"Olá, Graciele! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNsM1lmOVV3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Maria Helena Brugnago',
      5,
      'Fiquei muito satisfeita com atendimento',
      1712011383948,
      1712011383948,
      'Olá, Maria! 🌿 Estamos muito felizes com sua avaliação de 5 estrelas! Que ótimo saber que proporcionamos um momento de auto-cuidado e bem-estar digno de uma boa nota! 🤩 Esperamos nos ver em breve! 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":74,"id":"ChZDSUhNMG9nS0VJQ0FnSUNsM1lmOVV3EAE","name":"Maria Helena Brugnago","rating":5,"timeText":"Editado 2 anos atrás","text":"Fiquei muito satisfeita com atendimento","ownerResponse":"Olá, Maria! 🌿 Estamos muito felizes com sua avaliação de 5 estrelas! Que ótimo saber que proporcionamos um momento de auto-cuidado e bem-estar digno de uma boa nota! 🤩 Esperamos nos ver em breve! 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwLVlQWmlnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mariana Breidenbach',
      5,
      'Profissionais muito qualificados',
      1712011383948,
      1712011383948,
      'Olá, Mariana! 🌼 Agradecemos o reconhecimento! Ficamos honrados com seu feedback e nos motiva a continuar buscando a excelência em tudo o que fazemos! 💕 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":75,"id":"ChdDSUhNMG9nS0VJQ0FnSURwLVlQWmlnRRAB","name":"Mariana Breidenbach","rating":5,"timeText":"2 anos atrás","text":"Profissionais muito qualificados","ownerResponse":"Olá, Mariana! 🌼 Agradecemos o reconhecimento! Ficamos honrados com seu feedback e nos motiva a continuar buscando a excelência em tudo o que fazemos! 💕 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURMblpxWktBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Paula Vargas',
      5,
      'Atendimento maravilhoso!❤',
      1743547383948,
      1743547383948,
      'Olá Paula! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":76,"id":"ChZDSUhNMG9nS0VJQ0FnSURMblpxWktBEAE","name":"Paula Vargas","rating":5,"timeText":"Editado um ano atrás","text":"Atendimento maravilhoso!❤","ownerResponse":"Olá Paula! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNiODlPbXhnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Thiago Pereira Waseluch',
      5,
      'Excelente atendimento.',
      1743547383948,
      1743547383948,
      'Olá Thiago! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":77,"id":"ChdDSUhNMG9nS0VJQ0FnSUNiODlPbXhnRRAB","name":"Thiago Pereira Waseluch","rating":5,"timeText":"Editado um ano atrás","text":"Excelente atendimento.","ownerResponse":"Olá Thiago! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2taUlIzWkljMGRpWjJZM1kwbGFaemN6TjB4V2FVRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'veridiana de Zorzi',
      5,
      'Maravilhosa',
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":78,"id":"Ci9DQUlRQUNvZENodHljRjlvT2taUlIzWkljMGRpWjJZM1kwbGFaemN6TjB4V2FVRRAB","name":"veridiana de Zorzi","rating":5,"timeText":"5 meses atrás","text":"Maravilhosa","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURWMGNlWmFnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Gerusa Padilha',
      5,
      'Ótima amei',
      1712011383948,
      1712011383948,
      'Olá Gerusa! 💕 Gratos pela sua avaliação. É maravilhoso saber que você teve uma ótima experiência conosco! Esperamos vê-la novamente em breve para mais experiências incríveis. Muito obrigado por escolher a Espaço Facial! 🌹 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":79,"id":"ChZDSUhNMG9nS0VJQ0FnSURWMGNlWmFnEAE","name":"Gerusa Padilha","rating":5,"timeText":"2 anos atrás","text":"Ótima amei","ownerResponse":"Olá Gerusa! 💕 Gratos pela sua avaliação. É maravilhoso saber que você teve uma ótima experiência conosco! Esperamos vê-la novamente em breve para mais experiências incríveis. Muito obrigado por escolher a Espaço Facial! 🌹 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNGbzRxbXlRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Lorizete Leal',
      5,
      'Ótimo maravilhoso',
      1712011383948,
      1712011383948,
      'Olá, Lorizete! 🌻 Que alegria receber sua avaliação! Isso nos motiva ainda mais a continuar oferecendo serviços de alta qualidade para nossos clientes. Sua satisfação é a nossa maior recompensa! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":80,"id":"ChdDSUhNMG9nS0VJQ0FnSUNGbzRxbXlRRRAB","name":"Lorizete Leal","rating":5,"timeText":"2 anos atrás","text":"Ótimo maravilhoso","ownerResponse":"Olá, Lorizete! 🌻 Que alegria receber sua avaliação! Isso nos motiva ainda mais a continuar oferecendo serviços de alta qualidade para nossos clientes. Sua satisfação é a nossa maior recompensa! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNsMjllWUp3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'aline macari',
      5,
      'Ótima',
      1712011383948,
      1712011383948,
      'Olá Aline! 🌹 É maravilhoso saber que você teve uma ótima experiência conosco na Espaço Facial. Nos esforçamos para oferecer excelência em harmonização facial e tratamentos estéticos avançados, e seu feedback positivo é uma grande motivação para continuarmos nosso trabalho com dedicação e carinho. Esperamos vê-la novamente em breve para mais experiências incríveis! 🌟',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":81,"id":"ChZDSUhNMG9nS0VJQ0FnSUNsMjllWUp3EAE","name":"aline macari","rating":5,"timeText":"2 anos atrás","text":"Ótima","ownerResponse":"Olá Aline! 🌹 É maravilhoso saber que você teve uma ótima experiência conosco na Espaço Facial. Nos esforçamos para oferecer excelência em harmonização facial e tratamentos estéticos avançados, e seu feedback positivo é uma grande motivação para continuarmos nosso trabalho com dedicação e carinho. Esperamos vê-la novamente em breve para mais experiências incríveis! 🌟"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQ1MmREYWx3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Verani Aurelio',
      5,
      'Ótimo atendimento!',
      1712011383948,
      1712011383948,
      'Olá, Verani! 🌟 É uma honra receber seu reconhecimento sobre nosso serviço. Trabalhamos com afinco para entregar sempre o melhor, e é muito gratificante saber que estamos no caminho certo. Muito obrigado pela avaliação positiva! 🙌 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":82,"id":"ChdDSUhNMG9nS0VJQ0FnSUQ1MmREYWx3RRAB","name":"Verani Aurelio","rating":5,"timeText":"2 anos atrás","text":"Ótimo atendimento!","ownerResponse":"Olá, Verani! 🌟 É uma honra receber seu reconhecimento sobre nosso serviço. Trabalhamos com afinco para entregar sempre o melhor, e é muito gratificante saber que estamos no caminho certo. Muito obrigado pela avaliação positiva! 🙌 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNicXYyRFdREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jaqueline Sauthier',
      5,
      'Maravilhosa',
      1743547383948,
      1743547383948,
      'Olá Jaqueline! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":83,"id":"ChZDSUhNMG9nS0VJQ0FnSUNicXYyRFdREAE","name":"Jaqueline Sauthier","rating":5,"timeText":"um ano atrás","text":"Maravilhosa","ownerResponse":"Olá Jaqueline! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURqNk5lSjR3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Aline Cardoso',
      5,
      'Maravilhoso',
      1743547383948,
      1743547383948,
      'Olá Aline! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":84,"id":"ChdDSUhNMG9nS0VJQ0FnSURqNk5lSjR3RRAB","name":"Aline Cardoso","rating":5,"timeText":"um ano atrás","text":"Maravilhoso","ownerResponse":"Olá Aline! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNuX0lQa1JBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Uana Gaspar',
      5,
      'Super indico, preços e profissionais ótimos! Resultados perfeitos!',
      1774564983948,
      1774564983948,
      'Olá Uana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1774564983948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":85,"id":"ChZDSUhNMG9nS0VJQ0FnSUNuX0lQa1JBEAE","name":"Uana Gaspar","rating":5,"timeText":"Editado 6 dias atrás","text":"Super indico, preços e profissionais ótimos! Resultados perfeitos!","ownerResponse":"Olá Uana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xOWE1uWk9iM2hYTTFFMlNsSm5Ta3B4ZGsxclRXYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Leoni Pires',
      5,
      NULL,
      1774996983948,
      1774996983948,
      NULL,
      1774996983948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":86,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xOWE1uWk9iM2hYTTFFMlNsSm5Ta3B4ZGsxclRXYxAB","name":"Leoni Pires","rating":5,"timeText":"um dia atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xkSVVUTlBZVWw0VVRkSldrdHdRbGhJVTJaa05IYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Melissa Walzer Sant''Ana',
      5,
      NULL,
      1774651383948,
      1774651383948,
      NULL,
      1774651383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":87,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xkSVVUTlBZVWw0VVRkSldrdHdRbGhJVTJaa05IYxAB","name":"Melissa Walzer Sant''Ana","rating":5,"timeText":"5 dias atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2s1blJFcEtWbnBDVEhSclVtcHRNbk5EUm1jelJXYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bárbara da Silva',
      5,
      NULL,
      1773873783948,
      1773873783948,
      NULL,
      1773873783948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":88,"id":"Ci9DQUlRQUNvZENodHljRjlvT2s1blJFcEtWbnBDVEhSclVtcHRNbk5EUm1jelJXYxAB","name":"Bárbara da Silva","rating":5,"timeText":"2 semanas atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT214MFN6UjRkM0JvY2s5WlEwRmpMWHBUVDFOUlpsRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mari Silva',
      5,
      NULL,
      1773873783948,
      1773873783948,
      NULL,
      1773873783948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":89,"id":"Ci9DQUlRQUNvZENodHljRjlvT214MFN6UjRkM0JvY2s5WlEwRmpMWHBUVDFOUlpsRRAB","name":"Mari Silva","rating":5,"timeText":"2 semanas atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2t4amJGbE9TRFk1UlZCNVFtSXdaMWRDUkdSU05sRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Luciana Raimundo',
      5,
      NULL,
      1772491383948,
      1772491383948,
      NULL,
      1772491383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":90,"id":"Ci9DQUlRQUNvZENodHljRjlvT2t4amJGbE9TRFk1UlZCNVFtSXdaMWRDUkdSU05sRRAB","name":"Luciana Raimundo","rating":5,"timeText":"um mês atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT205UWFHRjBUVlZuWkVSNmVHSndSbmxRYlRKd2RYYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ana Cristina Dos Santos',
      5,
      NULL,
      1772491383948,
      1772491383948,
      NULL,
      1772491383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":91,"id":"Ci9DQUlRQUNvZENodHljRjlvT205UWFHRjBUVlZuWkVSNmVHSndSbmxRYlRKd2RYYxAB","name":"Ana Cristina Dos Santos","rating":5,"timeText":"um mês atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2t0WVVFTnlVVlJaU2xGdFVqTktOVXd6U2s5elJsRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'rochielle oliveira',
      5,
      NULL,
      1772491383948,
      1772491383948,
      NULL,
      1772491383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":92,"id":"Ci9DQUlRQUNvZENodHljRjlvT2t0WVVFTnlVVlJaU2xGdFVqTktOVXd6U2s5elJsRRAB","name":"rochielle oliveira","rating":5,"timeText":"um mês atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25WU1YyVXlUREYwWjNOSlZteExjemhYVjJwSGEzYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mauren Saile',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":93,"id":"Ci9DQUlRQUNvZENodHljRjlvT25WU1YyVXlUREYwWjNOSlZteExjemhYVjJwSGEzYxAB","name":"Mauren Saile","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2sxdE1saENaa0Z4VDBsUGMyRTNMVFJPV0V4a1RGRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Rondinelle Streb',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":94,"id":"Ci9DQUlRQUNvZENodHljRjlvT2sxdE1saENaa0Z4VDBsUGMyRTNMVFJPV0V4a1RGRRAB","name":"Rondinelle Streb","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21SVU1YSkNSazlHUjBoaFJqTlpZM0JITm5sa1FtYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Eliseu Buda',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":95,"id":"Ci9DQUlRQUNvZENodHljRjlvT21SVU1YSkNSazlHUjBoaFJqTlpZM0JITm5sa1FtYxAB","name":"Eliseu Buda","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pReVNXRktPRVEwTm5Bd1FVeFZUVFZpVEVWNVdFRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'PATRICIA PATY',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":96,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pReVNXRktPRVEwTm5Bd1FVeFZUVFZpVEVWNVdFRRAB","name":"PATRICIA PATY","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tOSmVuSjZMWFIxWVc1Vk5EQlNTa2Q2TkVKTGFYYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'katia rech',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":97,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tOSmVuSjZMWFIxWVc1Vk5EQlNTa2Q2TkVKTGFYYxAB","name":"katia rech","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25wcmFESlVRbTlHUjJOdU5GbHhRbVJMYURaeVozYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruna Gabriela Rigotti de Almeida',
      5,
      NULL,
      1767307383948,
      1767307383948,
      NULL,
      1767307383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":98,"id":"Ci9DQUlRQUNvZENodHljRjlvT25wcmFESlVRbTlHUjJOdU5GbHhRbVJMYURaeVozYxAB","name":"Bruna Gabriela Rigotti de Almeida","rating":5,"timeText":"3 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21GaVVHSnRObDl5YkdOMFMwdDVVa1ZzVGtNNFVVRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Kelly Frey Lewandowski',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":99,"id":"Ci9DQUlRQUNvZENodHljRjlvT21GaVVHSnRObDl5YkdOMFMwdDVVa1ZzVGtNNFVVRRAB","name":"Kelly Frey Lewandowski","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2pWdlluRnNMVzFWU1MxdGRGVm5VbnB6ZG1sU2VrRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Suzane Nunes',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":100,"id":"Ci9DQUlRQUNvZENodHljRjlvT2pWdlluRnNMVzFWU1MxdGRGVm5VbnB6ZG1sU2VrRRAB","name":"Suzane Nunes","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21wZlluSTBYMFZKTUc5QllsRm1VM0JwUkZwTU0xRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Patrick Rafael Scheid',
      4,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":101,"id":"Ci9DQUlRQUNvZENodHljRjlvT21wZlluSTBYMFZKTUc5QllsRm1VM0JwUkZwTU0xRRAB","name":"Patrick Rafael Scheid","rating":4,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT25wc1RsazVZV3hZTlROWVJHUklka3Q0WnpCb1prRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Alessandra Dubinsky',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":102,"id":"Ci9DQUlRQUNvZENodHljRjlvT25wc1RsazVZV3hZTlROWVJHUklka3Q0WnpCb1prRRAB","name":"Alessandra Dubinsky","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21rM01IaFNTWEExYURnNWNITkVkM295VkhrdGRYYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Fabiano Siqueira',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":103,"id":"Ci9DQUlRQUNvZENodHljRjlvT21rM01IaFNTWEExYURnNWNITkVkM295VkhrdGRYYxAB","name":"Fabiano Siqueira","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2xCV04xWTNTVzAwT0ZoMUxXNUZTRmhPVmxORE5VRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Claudete Alves',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":104,"id":"Ci9DQUlRQUNvZENodHljRjlvT2xCV04xWTNTVzAwT0ZoMUxXNUZTRmhPVmxORE5VRRAB","name":"Claudete Alves","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChRDSUhNMG9nS0VJQ0FnSUM3Z3I5ZxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Luciana Orige',
      5,
      NULL,
      1764715383948,
      1764715383948,
      'Olá Luciana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":105,"id":"ChRDSUhNMG9nS0VJQ0FnSUM3Z3I5ZxAB","name":"Luciana Orige","rating":5,"timeText":"Editado 4 meses atrás","text":"","ownerResponse":"Olá Luciana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tseFVtdHRSVU5FV2pKYWEycFBPVFZEU3kxemVHYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jaqueline Grings',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":106,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tseFVtdHRSVU5FV2pKYWEycFBPVFZEU3kxemVHYxAB","name":"Jaqueline Grings","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21RNVQzVmtaM05uTUdoTFNUZHNWbGw2VWtsd01sRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bianca Steffen Lopes',
      5,
      NULL,
      1764715383948,
      1764715383948,
      NULL,
      1764715383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":107,"id":"Ci9DQUlRQUNvZENodHljRjlvT21RNVQzVmtaM05uTUdoTFNUZHNWbGw2VWtsd01sRRAB","name":"Bianca Steffen Lopes","rating":5,"timeText":"4 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21WcFpqaDZjRU5yZGt4SlZXNWpUMnAzWW5wMlQwRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruno Vieira',
      5,
      NULL,
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":108,"id":"Ci9DQUlRQUNvZENodHljRjlvT21WcFpqaDZjRU5yZGt4SlZXNWpUMnAzWW5wMlQwRRAB","name":"Bruno Vieira","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21aNlZFZGZNWGxqWDNOdllYWk9kMWxmVHpGaUxYYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Claudine Streb',
      5,
      NULL,
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":109,"id":"Ci9DQUlRQUNvZENodHljRjlvT21aNlZFZGZNWGxqWDNOdllYWk9kMWxmVHpGaUxYYxAB","name":"Claudine Streb","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2sxeFFWOHdWMGhvWlRWeWVITjNjalZzZW1zMGMyYxAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Fernanda Hermes',
      5,
      NULL,
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":110,"id":"Ci9DQUlRQUNvZENodHljRjlvT2sxeFFWOHdWMGhvWlRWeWVITjNjalZzZW1zMGMyYxAB","name":"Fernanda Hermes","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT21OdGJYRTVkMDFHUkRaTlNVaEJiVlk0VmpGcWMwRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Liliane Beatriz Mirandoli',
      5,
      NULL,
      1762123383948,
      1762123383948,
      NULL,
      1762123383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":111,"id":"Ci9DQUlRQUNvZENodHljRjlvT21OdGJYRTVkMDFHUkRaTlNVaEJiVlk0VmpGcWMwRRAB","name":"Liliane Beatriz Mirandoli","rating":5,"timeText":"5 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2tSQ05FUTVZalpGWmxock1WSjZXbGszYWsxV1VWRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Marisete Richter Feiten',
      5,
      NULL,
      1759531383948,
      1759531383948,
      NULL,
      1759531383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":112,"id":"Ci9DQUlRQUNvZENodHljRjlvT2tSQ05FUTVZalpGWmxock1WSjZXbGszYWsxV1VWRRAB","name":"Marisete Richter Feiten","rating":5,"timeText":"6 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2swNU9GQTNVVVZDVXpSSFEyUm1XalIwWldwdFUxRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Geremias Da rosa',
      5,
      NULL,
      1759531383948,
      1759531383948,
      NULL,
      1759531383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":113,"id":"Ci9DQUlRQUNvZENodHljRjlvT2swNU9GQTNVVVZDVXpSSFEyUm1XalIwWldwdFUxRRAB","name":"Geremias Da rosa","rating":5,"timeText":"6 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'Ci9DQUlRQUNvZENodHljRjlvT2s5cVMydHRjbEo1UkhOeFlVUkNiMDVLVTFWR1NGRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Emerson Leonardo',
      5,
      NULL,
      1759531383948,
      1759531383948,
      NULL,
      1759531383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":114,"id":"Ci9DQUlRQUNvZENodHljRjlvT2s5cVMydHRjbEo1UkhOeFlVUkNiMDVLVTFWR1NGRRAB","name":"Emerson Leonardo","rating":5,"timeText":"6 meses atrás","text":"","ownerResponse":""}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnTUNnNlBYcjhBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Eva Fredes',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Eva! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":115,"id":"ChdDSUhNMG9nS0VJQ0FnTUNnNlBYcjhBRRAB","name":"Eva Fredes","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Eva! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUR2cWZhUS13RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Carla de Souza',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Muito obrigado pela sua avaliação 5 estrelas! ⭐⭐⭐⭐⭐

Sua satisfação é nossa maior recompensa! 💙✨ Estamos sempre aqui para oferecer o melhor atendimento e os melhores resultados.

Esperamos te ver em breve! 😊💖',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":116,"id":"ChdDSUhNMG9nS0VJQ0FnSUR2cWZhUS13RRAB","name":"Carla de Souza","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Muito obrigado pela sua avaliação 5 estrelas! ⭐⭐⭐⭐⭐\n\nSua satisfação é nossa maior recompensa! 💙✨ Estamos sempre aqui para oferecer o melhor atendimento e os melhores resultados.\n\nEsperamos te ver em breve! 😊💖"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURQNmFfYnJBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Angela Wolfart',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá, Angela! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":117,"id":"ChdDSUhNMG9nS0VJQ0FnSURQNmFfYnJBRRAB","name":"Angela Wolfart","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá, Angela! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNQNXZMMXJBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Cris Soares',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá, Cris! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":118,"id":"ChdDSUhNMG9nS0VJQ0FnSUNQNXZMMXJBRRAB","name":"Cris Soares","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá, Cris! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUQzeV9IUGZREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Cintia Ramos',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá, Cintia! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":119,"id":"ChZDSUhNMG9nS0VJQ0FnSUQzeV9IUGZREAE","name":"Cintia Ramos","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá, Cintia! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURuakplc3ZnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruna Oliveira',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Bruna! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":120,"id":"ChdDSUhNMG9nS0VJQ0FnSURuakplc3ZnRRAB","name":"Bruna Oliveira","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Bruna! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNueDd2NXpBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jéssica Rodolpho',
      4,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Jéssica! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":121,"id":"ChdDSUhNMG9nS0VJQ0FnSUNueDd2NXpBRRAB","name":"Jéssica Rodolpho","rating":4,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Jéssica! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURIM3FmaVpBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Fabiana Machado',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Fabiana! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":122,"id":"ChZDSUhNMG9nS0VJQ0FnSURIM3FmaVpBEAE","name":"Fabiana Machado","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Fabiana! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURieXVlTU1nEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Dani Silva',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Dani! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":123,"id":"ChZDSUhNMG9nS0VJQ0FnSURieXVlTU1nEAE","name":"Dani Silva","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Dani! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURyejVXYjdnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Clarisse Callegari',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Clarisse! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":124,"id":"ChdDSUhNMG9nS0VJQ0FnSURyejVXYjdnRRAB","name":"Clarisse Callegari","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Clarisse! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURyeF9IUnZnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Lisiane Rosa',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Lisiane! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":125,"id":"ChdDSUhNMG9nS0VJQ0FnSURyeF9IUnZnRRAB","name":"Lisiane Rosa","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Lisiane! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURyb09yWE1BEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ines Colissi',
      1,
      NULL,
      1743547383948,
      1743547383948,
      'Olá, Ines! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.

Além disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.

Esperamos vê-la novamente em breve! 💐',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":126,"id":"ChZDSUhNMG9nS0VJQ0FnSURyb09yWE1BEAE","name":"Ines Colissi","rating":1,"timeText":"um ano atrás","text":"","ownerResponse":"Olá, Ines! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.\n\nAlém disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.\n\nEsperamos vê-la novamente em breve! 💐"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURMbm9hdEdBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Roberta Pirotti',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Roberta! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":127,"id":"ChZDSUhNMG9nS0VJQ0FnSURMbm9hdEdBEAE","name":"Roberta Pirotti","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Roberta! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNUck9iZThnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Solange de Fatima Suleiman Mohd Shama',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Solange! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":128,"id":"ChdDSUhNMG9nS0VJQ0FnSUNUck9iZThnRRAB","name":"Solange de Fatima Suleiman Mohd Shama","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Solange! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURqdktMTmxRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ivone Gregianin',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Ivone 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":129,"id":"ChdDSUhNMG9nS0VJQ0FnSURqdktMTmxRRRAB","name":"Ivone Gregianin","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Ivone 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNqX19YSi1RRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jaja Restaurante',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço. Nossa equipe se dedica a oferecer o melhor atendimento e tratamentos de alta qualidade. Seu feedback é muito importante para nós!',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":130,"id":"ChdDSUhNMG9nS0VJQ0FnSUNqX19YSi1RRRAB","name":"Jaja Restaurante","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço. Nossa equipe se dedica a oferecer o melhor atendimento e tratamentos de alta qualidade. Seu feedback é muito importante para nós!"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUREazVTVUNREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'rosane fischer',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Agradecemos a avaliação de 5 estrelas! 🌟 Ficamos extremamente felizes em saber que você teve uma experiência positiva conosco. Se houver qualquer outra coisa em que possamos ajudar ou se desejar agendar outro tratamento, não hesite em entrar em contato. Sua satisfação é muito importante para nós! 🌺 …',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":131,"id":"ChZDSUhNMG9nS0VJQ0FnSUREazVTVUNREAE","name":"rosane fischer","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Agradecemos a avaliação de 5 estrelas! 🌟 Ficamos extremamente felizes em saber que você teve uma experiência positiva conosco. Se houver qualquer outra coisa em que possamos ajudar ou se desejar agendar outro tratamento, não hesite em entrar em contato. Sua satisfação é muito importante para nós! 🌺 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUREaHFmb253RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Adriane Hilário',
      4,
      NULL,
      1743547383948,
      1743547383948,
      'Olá, Adriane! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.

Além disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.

Esperamos vê-la novamente em breve! 💐',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":132,"id":"ChdDSUhNMG9nS0VJQ0FnSUREaHFmb253RRAB","name":"Adriane Hilário","rating":4,"timeText":"um ano atrás","text":"","ownerResponse":"Olá, Adriane! Valorizamos cada feedback, pois ele é essencial para continuarmos melhorando nossos serviços. 🌼 Gostaríamos de entender melhor o que poderíamos ter feito para tornar sua experiência ainda mais completa, alcançando a nota máxima. Se houver alguma sugestão ou ponto que acreditamos que poderíamos melhorar, ficaríamos gratos em ouvir.\n\nAlém disso, se após nosso bate-papo você se sentir inclinada a ajustar sua avaliação, isso certamente ajudaria outros clientes a conhecerem melhor a qualidade e o cuidado que proporcionamos aqui na Espaço Facial.\n\nEsperamos vê-la novamente em breve! 💐"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUREbE1xVnFRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Rafaela Cargnin',
      5,
      NULL,
      1743547383948,
      1743547383948,
      'Olá Rafaela! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1743547383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":133,"id":"ChdDSUhNMG9nS0VJQ0FnSUREbE1xVnFRRRAB","name":"Rafaela Cargnin","rating":5,"timeText":"um ano atrás","text":"","ownerResponse":"Olá Rafaela! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNEbS1pV3pRRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Clarissa Cunha de Araújo',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá Clarissa! 🥰
Muito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.

Atenciosamente,
Equipe Espaço Facial',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":134,"id":"ChdDSUhNMG9nS0VJQ0FnSUNEbS1pV3pRRRAB","name":"Clarissa Cunha de Araújo","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá Clarissa! 🥰\nMuito obrigada por sua avaliação de 5 estrelas! Ficamos extremamente felizes em saber que teve uma experiência tão positiva em nosso espaço.\n\nAtenciosamente,\nEquipe Espaço Facial"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUQ5MnZhQ0NnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'fernanda. dos santos',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Muito obrigado, Fernanda! É uma alegria para nós receber uma avaliação de 5 estrelas. ✨ Estamos sempre trabalhando para oferecer o melhor serviço possível. Se tiver alguma sugestão ou desejar conhecer outros tratamentos, estamos à disposição. Esperamos vê-la novamente em breve! Um abraço carinhoso. 🌸 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":135,"id":"ChZDSUhNMG9nS0VJQ0FnSUQ5MnZhQ0NnEAE","name":"fernanda. dos santos","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Muito obrigado, Fernanda! É uma alegria para nós receber uma avaliação de 5 estrelas. ✨ Estamos sempre trabalhando para oferecer o melhor serviço possível. Se tiver alguma sugestão ou desejar conhecer outros tratamentos, estamos à disposição. Esperamos vê-la novamente em breve! Um abraço carinhoso. 🌸 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUQ5a1BfRDJnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Sonilda Percoski',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Obrigado pelo feedback, Sonilda! Ficamos muito felizes em saber que você teve uma experiência 5 estrelas conosco. 🌟 Estamos à disposição para o que precisar e esperamos vê-la novamente em breve. Se tiver alguma dúvida ou precisar de mais informações sobre nossos tratamentos, é só nos chamar. Um abraço! 🤗 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":136,"id":"ChdDSUhNMG9nS0VJQ0FnSUQ5a1BfRDJnRRAB","name":"Sonilda Percoski","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Obrigado pelo feedback, Sonilda! Ficamos muito felizes em saber que você teve uma experiência 5 estrelas conosco. 🌟 Estamos à disposição para o que precisar e esperamos vê-la novamente em breve. Se tiver alguma dúvida ou precisar de mais informações sobre nossos tratamentos, é só nos chamar. Um abraço! 🤗 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURkbU4taEN3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Dina gessler',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Diná! Estamos gratos pela avaliação de 5 estrelas! 😊 Nos empenhamos para oferecer excelência em todos os nossos serviços, e é maravilhoso ver esse esforço refletido na satisfação de nossos clientes. Muito obrigado por escolher a Espaço Facial! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":137,"id":"ChZDSUhNMG9nS0VJQ0FnSURkbU4taEN3EAE","name":"Dina gessler","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Diná! Estamos gratos pela avaliação de 5 estrelas! 😊 Nos empenhamos para oferecer excelência em todos os nossos serviços, e é maravilhoso ver esse esforço refletido na satisfação de nossos clientes. Muito obrigado por escolher a Espaço Facial! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNkei1yWnNBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ana Amaral',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Ana! Que ótimo receber uma avaliação de 5 estrelas! 🌟 Isso significa muito para nós da Espaço Facial. Agradecemos o reconhecimento e estamos felizes por termos atendido às suas expectativas. Esperamos continuar a fornecer experiências excepcionais para você e a todos os nossos clientes! 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":138,"id":"ChdDSUhNMG9nS0VJQ0FnSUNkei1yWnNBRRAB","name":"Ana Amaral","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Ana! Que ótimo receber uma avaliação de 5 estrelas! 🌟 Isso significa muito para nós da Espaço Facial. Agradecemos o reconhecimento e estamos felizes por termos atendido às suas expectativas. Esperamos continuar a fornecer experiências excepcionais para você e a todos os nossos clientes! 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNkdk5hNGFnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Luana Zanotti',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Luana! 😊 Que bom saber que você adorou nosso atendimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Agradecemos sua avaliação e esperamos continuar oferecendo um ótimo serviço. 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":139,"id":"ChZDSUhNMG9nS0VJQ0FnSUNkdk5hNGFnEAE","name":"Luana Zanotti","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Luana! 😊 Que bom saber que você adorou nosso atendimento! Nosso compromisso com o cuidado e a satisfação total dos nossos clientes é constante. Agradecemos sua avaliação e esperamos continuar oferecendo um ótimo serviço. 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNkMElEMGhBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Giovana Bortoli',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Giovana! Estamos super felizes com sua avaliação de 5 estrelas! 🌟 É uma grande alegria saber que conseguimos atender às suas expectativas com excelência. Seu reconhecimento é muito importante para nós e nos motiva a continuar oferecendo o melhor serviço possível. Agradecemos pela sua confiança e esperamos vê-la novamente em breve para mais experiências incríveis! 💕',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":140,"id":"ChdDSUhNMG9nS0VJQ0FnSUNkMElEMGhBRRAB","name":"Giovana Bortoli","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Giovana! Estamos super felizes com sua avaliação de 5 estrelas! 🌟 É uma grande alegria saber que conseguimos atender às suas expectativas com excelência. Seu reconhecimento é muito importante para nós e nos motiva a continuar oferecendo o melhor serviço possível. Agradecemos pela sua confiança e esperamos vê-la novamente em breve para mais experiências incríveis! 💕"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUNka0tHZFpnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Fabiane Miranda',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Fabiane! Receber uma avaliação de 5 estrelas é sempre um motivo de grande celebração para nossa equipe! 🎉 Estamos extremamente gratos por você ter escolhido a Espaço Facial e por confiar em nosso trabalho. Seu reconhecimento é um sinal de que estamos no caminho certo, oferecendo serviços de alta qualidade que atendem e superam as expectativas. Esperamos continuar sendo sua escolha para cuidados estéticos e bem-estar. Muito obrigado! 💖',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":141,"id":"ChZDSUhNMG9nS0VJQ0FnSUNka0tHZFpnEAE","name":"Fabiane Miranda","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Fabiane! Receber uma avaliação de 5 estrelas é sempre um motivo de grande celebração para nossa equipe! 🎉 Estamos extremamente gratos por você ter escolhido a Espaço Facial e por confiar em nosso trabalho. Seu reconhecimento é um sinal de que estamos no caminho certo, oferecendo serviços de alta qualidade que atendem e superam as expectativas. Esperamos continuar sendo sua escolha para cuidados estéticos e bem-estar. Muito obrigado! 💖"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSUMxNnB1cWFBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Elo Só ela mesmo',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá! ☀️ Estamos imensamente agradecidos por você ter compartilhado sua experiência positiva. Sua satisfação é nossa maior recompensa e motivação. Esperamos continuar a iluminar o seu dia com nossos cuidados e atenção. Muito obrigado por nos escolher! 💖 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":142,"id":"ChZDSUhNMG9nS0VJQ0FnSUMxNnB1cWFBEAE","name":"Elo Só ela mesmo","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá! ☀️ Estamos imensamente agradecidos por você ter compartilhado sua experiência positiva. Sua satisfação é nossa maior recompensa e motivação. Esperamos continuar a iluminar o seu dia com nossos cuidados e atenção. Muito obrigado por nos escolher! 💖 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNWdmZLR3BBRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Ale Arnold Spohn',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá Ale! 🌹 Estamos muito gratos pela sua avaliação de 5 estrelas! É maravilhoso saber que você teve uma ótima experiência conosco na Espaço Facial. Esperamos vê-la novamente em breve para mais experiências incríveis. 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":143,"id":"ChdDSUhNMG9nS0VJQ0FnSUNWdmZLR3BBRRAB","name":"Ale Arnold Spohn","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá Ale! 🌹 Estamos muito gratos pela sua avaliação de 5 estrelas! É maravilhoso saber que você teve uma ótima experiência conosco na Espaço Facial. Esperamos vê-la novamente em breve para mais experiências incríveis. 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSUNseFlybW9RRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Luciane Buosi Benides',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Luciane! 🌟 Agradecemos profundamente pela avaliação de 5 estrelas. É um grande incentivo para nós saber que estamos atendendo às expectativas dos nossos clientes com excelência. Estamos sempre à disposição para proporcionar o melhor em cada visita. Muito obrigado pelo seu apoio! 🌈 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":144,"id":"ChdDSUhNMG9nS0VJQ0FnSUNseFlybW9RRRAB","name":"Luciane Buosi Benides","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Luciane! 🌟 Agradecemos profundamente pela avaliação de 5 estrelas. É um grande incentivo para nós saber que estamos atendendo às expectativas dos nossos clientes com excelência. Estamos sempre à disposição para proporcionar o melhor em cada visita. Muito obrigado pelo seu apoio! 🌈 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwOC02b1FBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Michele Santos',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Micheli! ✨ Agradecemos a sua avaliação de 5 estrelas! Sua satisfação é nossa prioridade e ficamos muito felizes em saber que conseguimos atendê-la da melhor forma. Aguardamos sua próxima visita! 🌷 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":145,"id":"ChZDSUhNMG9nS0VJQ0FnSURwOC02b1FBEAE","name":"Michele Santos","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Micheli! ✨ Agradecemos a sua avaliação de 5 estrelas! Sua satisfação é nossa prioridade e ficamos muito felizes em saber que conseguimos atendê-la da melhor forma. Aguardamos sua próxima visita! 🌷 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwNWI3dWpnRRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Bruno Poli',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Bruno! 🍁 Agradecemos sua avaliação! Valorizamos cada feedback e esperamos sempre proporcionar experiências memoráveis! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":146,"id":"ChdDSUhNMG9nS0VJQ0FnSURwNWI3dWpnRRAB","name":"Bruno Poli","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Bruno! 🍁 Agradecemos sua avaliação! Valorizamos cada feedback e esperamos sempre proporcionar experiências memoráveis! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwNWR6cERnEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Camila Schneider Lopes',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Camila! 🩷 Agradecemos a avaliação. Sua satisfação é de grande valor para nós! 🙌 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":147,"id":"ChZDSUhNMG9nS0VJQ0FnSURwNWR6cERnEAE","name":"Camila Schneider Lopes","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Camila! 🩷 Agradecemos a avaliação. Sua satisfação é de grande valor para nós! 🙌 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwcGJydER3EAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Josiele Maiara',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Josiele! 🌸 Que alegria receber sua avaliação! Cada estrela que recebemos é um reflexo do nosso compromisso em entregar o melhor! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":148,"id":"ChZDSUhNMG9nS0VJQ0FnSURwcGJydER3EAE","name":"Josiele Maiara","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Josiele! 🌸 Que alegria receber sua avaliação! Cada estrela que recebemos é um reflexo do nosso compromisso em entregar o melhor! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwaGZpMFFREAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Cleberson Malacarne',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Cleberson! 🍃 Seu feedback é valioso e nos inspira a seguir em busca da excelência. Obrigado por confiar em nossa equipe e por reconhecer o valor do nosso trabalho! 🌟 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":149,"id":"ChZDSUhNMG9nS0VJQ0FnSURwaGZpMFFREAE","name":"Cleberson Malacarne","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Cleberson! 🍃 Seu feedback é valioso e nos inspira a seguir em busca da excelência. Obrigado por confiar em nossa equipe e por reconhecer o valor do nosso trabalho! 🌟 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChZDSUhNMG9nS0VJQ0FnSURwdWFiR1dBEAE',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Mauricio Benito',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Mauricio! 🌠 Agradecemos pela sua avaliação. Esperamos continuar correspondendo às suas expectativas! 🙌 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":150,"id":"ChZDSUhNMG9nS0VJQ0FnSURwdWFiR1dBEAE","name":"Mauricio Benito","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Mauricio! 🌠 Agradecemos pela sua avaliação. Esperamos continuar correspondendo às suas expectativas! 🙌 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      'ChdDSUhNMG9nS0VJQ0FnSURwMmRQRXh3RRAB',
      'novo-hamburgo',
      'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
      'Jose Fernando Lima Rodrigues',
      5,
      NULL,
      1712011383948,
      1712011383948,
      'Olá, Fernando! 🌾 Agradecemos sua avaliação. Estamos sempre à disposição para oferecer o melhor. 💪 …',
      1712011383948,
      '{"source":"manual-google-maps-browser-export","exportedAt":"2026-04-01T22:43:03.948Z","review":{"index":151,"id":"ChdDSUhNMG9nS0VJQ0FnSURwMmRQRXh3RRAB","name":"Jose Fernando Lima Rodrigues","rating":5,"timeText":"2 anos atrás","text":"","ownerResponse":"Olá, Fernando! 🌾 Agradecemos sua avaliação. Estamos sempre à disposição para oferecer o melhor. 💪 …"}}',
      1775083592851,
      1775083592851
    );

INSERT INTO gbp_review_sync_runs (
    id, unit_slug, place_id, started_at_ms, finished_at_ms, success, fetched_reviews, error
  ) VALUES (
    'manual_novo-hamburgo_1775083383948',
    'novo-hamburgo',
    'ChIJhaCsZ9RDGZURe9I0bpIb-CM',
    1775083383948,
    1775083592851,
    1,
    152,
    NULL
  );
