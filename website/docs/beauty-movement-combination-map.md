# Matriz de combinações — Cartas da Beleza

Versão do resolver: `beauty-movement-outcomes-v2`
Resolver puro, determinístico e sem dados pessoais. A paleta escolhe o deck; não escolhe o resultado.

## Revisão editorial

A matriz foi revisada para que a coerência da história venha antes da igualdade matemática. Potência + Renovação reforça Firmeza & Renovação; Radiância/Presença + Confiança/Brilho reforçam Hidratação & Luminosidade; Autoria/Constância reforça continuidade; Autocuidado + Potência/Ritmo resolve a leitura de estímulo sem depender do desempate. A paleta continua enviesando o deck por semântica, mas cada paleta alcança os quatro outcomes.

## Regra de desempate

Somam-se as afinidades explícitas das três cartas e as sinergias documentadas no código. Em empate, a ordem estável é Elleva → Preenchimento → Restylane Classic + Sculptra → Skinbooster + Diamond.

## Cobertura

Total: **81** combinações (3 paletas × 3³ escolhas).

- `elleva_upgrade`: 22
- `filler_double`: 23
- `sculptra_classic_unlock`: 16
- `skinbooster_diamond_unlock`: 20

Distribuição por paleta (a assimetria é semântica; nenhum outcome é bloqueado):

| Paleta | Elleva | Preenchimento | Restylane Classic + Sculptra | Skinbooster + Diamond |
| --- | ---: | ---: | ---: | ---: |
| radiancia | 6 | 4 | 1 | 16 |
| ritmo | 9 | 3 | 13 | 2 |
| conexao | 7 | 16 | 2 | 2 |

## Matriz completa

| Paleta | Beleza | Movimento | Celebração | Títulos | Oferta desbloqueada | Pontuação | Justificativa editorial |
| --- | --- | --- | --- | --- | --- | --- | --- |
| radiancia | beleza-presenca | movimento-constancia | celebracao-confianca | Presença / Constância / Confiança | filler_double | 7–5 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| radiancia | beleza-presenca | movimento-constancia | celebracao-renovacao | Presença / Constância / Renovação | elleva_upgrade | 11–4 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-presenca | movimento-constancia | celebracao-brilho | Presença / Constância / Brilho | skinbooster_diamond_unlock | 8–5 | Presença e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-presenca | movimento-potencia | celebracao-confianca | Presença / Potência / Confiança | filler_double | 7–4 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| radiancia | beleza-presenca | movimento-potencia | celebracao-renovacao | Presença / Potência / Renovação | elleva_upgrade | 7–4 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-presenca | movimento-potencia | celebracao-brilho | Presença / Potência / Brilho | skinbooster_diamond_unlock | 7–5 | Presença e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-presenca | movimento-leveza | celebracao-confianca | Presença / Leveza / Confiança | filler_double | 8–4 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| radiancia | beleza-presenca | movimento-leveza | celebracao-renovacao | Presença / Leveza / Renovação | filler_double | 5–5 | Empate entre Harmonia & Definição e Hidratação & Luminosidade; Harmonia & Definição vence pela ordem de desempate estável, apoiado por Presença e Leveza. |
| radiancia | beleza-presenca | movimento-leveza | celebracao-brilho | Presença / Leveza / Brilho | skinbooster_diamond_unlock | 10–6 | Presença e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-constancia | celebracao-confianca | Autocuidado / Constância / Confiança | skinbooster_diamond_unlock | 7–6 | Autocuidado e Constância reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-constancia | celebracao-renovacao | Autocuidado / Constância / Renovação | elleva_upgrade | 12–8 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-constancia | celebracao-brilho | Autocuidado / Constância / Brilho | skinbooster_diamond_unlock | 14–5 | Autocuidado e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-potencia | celebracao-confianca | Autocuidado / Potência / Confiança | sculptra_classic_unlock | 6–4 | Autocuidado e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-potencia | celebracao-renovacao | Autocuidado / Potência / Renovação | elleva_upgrade | 8–6 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-potencia | celebracao-brilho | Autocuidado / Potência / Brilho | skinbooster_diamond_unlock | 11–6 | Autocuidado e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-autocuidado | movimento-leveza | celebracao-confianca | Autocuidado / Leveza / Confiança | skinbooster_diamond_unlock | 7–4 | Autocuidado e Leveza concentram a maior afinidade em Hidratação & Luminosidade. |
| radiancia | beleza-autocuidado | movimento-leveza | celebracao-renovacao | Autocuidado / Leveza / Renovação | skinbooster_diamond_unlock | 8–5 | Autocuidado e Leveza concentram a maior afinidade em Hidratação & Luminosidade. |
| radiancia | beleza-autocuidado | movimento-leveza | celebracao-brilho | Autocuidado / Leveza / Brilho | skinbooster_diamond_unlock | 14–2 | Autocuidado e Brilho reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-constancia | celebracao-confianca | Radiância / Constância / Confiança | skinbooster_diamond_unlock | 7–5 | Radiância e Confiança reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-constancia | celebracao-renovacao | Radiância / Constância / Renovação | elleva_upgrade | 11–6 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-constancia | celebracao-brilho | Radiância / Constância / Brilho | skinbooster_diamond_unlock | 9–4 | Brilho e Radiância concentram a maior afinidade em Hidratação & Luminosidade. |
| radiancia | beleza-radiancia | movimento-potencia | celebracao-confianca | Radiância / Potência / Confiança | skinbooster_diamond_unlock | 6–4 | Radiância e Confiança reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-potencia | celebracao-renovacao | Radiância / Potência / Renovação | elleva_upgrade | 7–5 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-potencia | celebracao-brilho | Radiância / Potência / Brilho | skinbooster_diamond_unlock | 8–4 | Brilho e Radiância concentram a maior afinidade em Hidratação & Luminosidade. |
| radiancia | beleza-radiancia | movimento-leveza | celebracao-confianca | Radiância / Leveza / Confiança | skinbooster_diamond_unlock | 11–5 | Radiância e Confiança reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-leveza | celebracao-renovacao | Radiância / Leveza / Renovação | skinbooster_diamond_unlock | 10–4 | Radiância e Leveza reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| radiancia | beleza-radiancia | movimento-leveza | celebracao-brilho | Radiância / Leveza / Brilho | skinbooster_diamond_unlock | 13–3 | Radiância e Leveza reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-presenca | movimento-constancia | celebracao-confianca | Presença / Constância / Confiança | filler_double | 7–5 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| ritmo | beleza-presenca | movimento-constancia | celebracao-renovacao | Presença / Constância / Renovação | elleva_upgrade | 11–4 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-presenca | movimento-constancia | celebracao-impulso | Presença / Constância / Impulso | elleva_upgrade | 5–4 | Constância e Impulso concentram a maior afinidade em Firmeza & Renovação. |
| ritmo | beleza-presenca | movimento-potencia | celebracao-confianca | Presença / Potência / Confiança | filler_double | 7–4 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| ritmo | beleza-presenca | movimento-potencia | celebracao-renovacao | Presença / Potência / Renovação | elleva_upgrade | 7–4 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-presenca | movimento-potencia | celebracao-impulso | Presença / Potência / Impulso | sculptra_classic_unlock | 8–4 | Impulso e Potência concentram a maior afinidade em Estrutura & Estímulo. |
| ritmo | beleza-presenca | movimento-ritmo | celebracao-confianca | Presença / Ritmo / Confiança | filler_double | 7–4 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| ritmo | beleza-presenca | movimento-ritmo | celebracao-renovacao | Presença / Ritmo / Renovação | elleva_upgrade | 5–4 | Renovação e Ritmo concentram a maior afinidade em Firmeza & Renovação. |
| ritmo | beleza-presenca | movimento-ritmo | celebracao-impulso | Presença / Ritmo / Impulso | sculptra_classic_unlock | 11–4 | Ritmo e Impulso reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-constancia | celebracao-confianca | Autocuidado / Constância / Confiança | skinbooster_diamond_unlock | 7–6 | Autocuidado e Constância reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-constancia | celebracao-renovacao | Autocuidado / Constância / Renovação | elleva_upgrade | 12–8 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-constancia | celebracao-impulso | Autocuidado / Constância / Impulso | skinbooster_diamond_unlock | 7–6 | Autocuidado e Constância reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-potencia | celebracao-confianca | Autocuidado / Potência / Confiança | sculptra_classic_unlock | 6–4 | Autocuidado e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-potencia | celebracao-renovacao | Autocuidado / Potência / Renovação | elleva_upgrade | 8–6 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-potencia | celebracao-impulso | Autocuidado / Potência / Impulso | sculptra_classic_unlock | 10–4 | Autocuidado e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-ritmo | celebracao-confianca | Autocuidado / Ritmo / Confiança | sculptra_classic_unlock | 5–4 | Autocuidado e Ritmo reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autocuidado | movimento-ritmo | celebracao-renovacao | Autocuidado / Ritmo / Renovação | elleva_upgrade | 6–5 | Renovação e Autocuidado concentram a maior afinidade em Firmeza & Renovação. |
| ritmo | beleza-autocuidado | movimento-ritmo | celebracao-impulso | Autocuidado / Ritmo / Impulso | sculptra_classic_unlock | 12–4 | Autocuidado e Ritmo reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-constancia | celebracao-confianca | Autoria / Constância / Confiança | elleva_upgrade | 7–4 | Autoria e Constância reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-constancia | celebracao-renovacao | Autoria / Constância / Renovação | elleva_upgrade | 13–4 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-constancia | celebracao-impulso | Autoria / Constância / Impulso | sculptra_classic_unlock | 8–7 | Autoria e Impulso concentram a maior afinidade em Estrutura & Estímulo. |
| ritmo | beleza-autoria | movimento-potencia | celebracao-confianca | Autoria / Potência / Confiança | sculptra_classic_unlock | 11–4 | Autoria e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-potencia | celebracao-renovacao | Autoria / Potência / Renovação | sculptra_classic_unlock | 11–7 | Autoria e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-potencia | celebracao-impulso | Autoria / Potência / Impulso | sculptra_classic_unlock | 15–2 | Autoria e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| ritmo | beleza-autoria | movimento-ritmo | celebracao-confianca | Autoria / Ritmo / Confiança | sculptra_classic_unlock | 8–4 | Autoria e Ritmo concentram a maior afinidade em Estrutura & Estímulo. |
| ritmo | beleza-autoria | movimento-ritmo | celebracao-renovacao | Autoria / Ritmo / Renovação | sculptra_classic_unlock | 8–5 | Autoria e Ritmo concentram a maior afinidade em Estrutura & Estímulo. |
| ritmo | beleza-autoria | movimento-ritmo | celebracao-impulso | Autoria / Ritmo / Impulso | sculptra_classic_unlock | 15–2 | Ritmo e Impulso reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-presenca | movimento-constancia | celebracao-confianca | Presença / Constância / Confiança | filler_double | 7–5 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-presenca | movimento-constancia | celebracao-renovacao | Presença / Constância / Renovação | elleva_upgrade | 11–4 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-presenca | movimento-constancia | celebracao-encontro | Presença / Constância / Encontro | filler_double | 7–4 | Presença e Encontro concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-presenca | movimento-potencia | celebracao-confianca | Presença / Potência / Confiança | filler_double | 7–4 | Presença e Confiança concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-presenca | movimento-potencia | celebracao-renovacao | Presença / Potência / Renovação | elleva_upgrade | 7–4 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-presenca | movimento-potencia | celebracao-encontro | Presença / Potência / Encontro | filler_double | 7–4 | Presença e Encontro concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-presenca | movimento-sintonia | celebracao-confianca | Presença / Sintonia / Confiança | filler_double | 12–2 | Presença e Sintonia reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-presenca | movimento-sintonia | celebracao-renovacao | Presença / Sintonia / Renovação | filler_double | 9–5 | Presença e Sintonia reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-presenca | movimento-sintonia | celebracao-encontro | Presença / Sintonia / Encontro | filler_double | 12–2 | Presença e Sintonia reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-constancia | celebracao-confianca | Autocuidado / Constância / Confiança | skinbooster_diamond_unlock | 7–6 | Autocuidado e Constância reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-constancia | celebracao-renovacao | Autocuidado / Constância / Renovação | elleva_upgrade | 12–8 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-constancia | celebracao-encontro | Autocuidado / Constância / Encontro | skinbooster_diamond_unlock | 8–5 | Autocuidado e Constância reforçam Hidratação & Luminosidade; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-potencia | celebracao-confianca | Autocuidado / Potência / Confiança | sculptra_classic_unlock | 6–4 | Autocuidado e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-potencia | celebracao-renovacao | Autocuidado / Potência / Renovação | elleva_upgrade | 8–6 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-potencia | celebracao-encontro | Autocuidado / Potência / Encontro | sculptra_classic_unlock | 6–5 | Autocuidado e Potência reforçam Estrutura & Estímulo; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-autocuidado | movimento-sintonia | celebracao-confianca | Autocuidado / Sintonia / Confiança | filler_double | 6–4 | Confiança e Sintonia concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-autocuidado | movimento-sintonia | celebracao-renovacao | Autocuidado / Sintonia / Renovação | elleva_upgrade | 6–5 | Renovação e Autocuidado concentram a maior afinidade em Firmeza & Renovação. |
| conexao | beleza-autocuidado | movimento-sintonia | celebracao-encontro | Autocuidado / Sintonia / Encontro | filler_double | 6–5 | Encontro e Sintonia concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-harmonia | movimento-constancia | celebracao-confianca | Harmonia / Constância / Confiança | filler_double | 7–6 | Harmonia e Confiança concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-harmonia | movimento-constancia | celebracao-renovacao | Harmonia / Constância / Renovação | elleva_upgrade | 12–4 | Constância e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-harmonia | movimento-constancia | celebracao-encontro | Harmonia / Constância / Encontro | filler_double | 9–5 | Harmonia e Encontro reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-harmonia | movimento-potencia | celebracao-confianca | Harmonia / Potência / Confiança | filler_double | 7–4 | Harmonia e Confiança concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-harmonia | movimento-potencia | celebracao-renovacao | Harmonia / Potência / Renovação | elleva_upgrade | 8–4 | Potência e Renovação reforçam Firmeza & Renovação; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-harmonia | movimento-potencia | celebracao-encontro | Harmonia / Potência / Encontro | filler_double | 9–4 | Harmonia e Encontro reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
| conexao | beleza-harmonia | movimento-sintonia | celebracao-confianca | Harmonia / Sintonia / Confiança | filler_double | 10–3 | Harmonia e Confiança concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-harmonia | movimento-sintonia | celebracao-renovacao | Harmonia / Sintonia / Renovação | filler_double | 7–6 | Harmonia e Sintonia concentram a maior afinidade em Harmonia & Definição. |
| conexao | beleza-harmonia | movimento-sintonia | celebracao-encontro | Harmonia / Sintonia / Encontro | filler_double | 12–2 | Harmonia e Encontro reforçam Harmonia & Definição; as demais afinidades mantêm a leitura coerente. |
