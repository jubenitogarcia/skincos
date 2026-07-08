export const BOOKING_CONFIRMATION_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Confirmação de Reserva | Espaço Facial</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #fafafa;
      font-family: Inter, Montserrat, Poppins, Arial, Helvetica, sans-serif;
      color: #303030;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table {
      border-spacing: 0;
      border-collapse: collapse;
    }

    img {
      border: 0;
      display: block;
      line-height: 100%;
      max-width: 100%;
      height: auto;
    }

    a {
      text-decoration: none;
    }

    .email-bg {
      width: 100%;
      background: linear-gradient(180deg, #fafafa 0%, #f4f1f0 100%);
    }

    .container {
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      background-color: #ffffff;
    }

    .hero {
      background: radial-gradient(circle at top right, rgba(208,208,208,0.35), rgba(250,250,250,0) 28%), linear-gradient(180deg, #fafafa 0%, #f2efee 100%);
    }

    .card {
      background-color: #ffffff;
      border: 1px solid #e9e9e9;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(48, 48, 48, 0.05);
    }

    .soft-card {
      background-color: #f8f8f8;
      border: 1px solid #ededed;
      border-radius: 12px;
    }

    .eyebrow {
      display: inline-block;
      font-size: 12px;
      line-height: 12px;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      color: #505050;
      padding: 8px 12px;
      background-color: #f3f3f3;
      border-radius: 999px;
    }

    .title {
      font-size: 34px;
      line-height: 40px;
      font-weight: 700;
      color: #303030;
      margin: 0;
    }

    .subtitle {
      font-size: 18px;
      line-height: 29px;
      color: #505050;
      margin: 0;
    }

    .section-title {
      font-size: 26px;
      line-height: 32px;
      font-weight: 700;
      color: #303030;
      margin: 0;
    }

    .body-text {
      font-size: 15px;
      line-height: 24px;
      color: #505050;
      margin: 0;
    }

    .detail-label {
      font-size: 12px;
      line-height: 16px;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #767676;
    }

    .detail-value {
      font-size: 17px;
      line-height: 24px;
      font-weight: 600;
      color: #303030;
    }

    .cta {
      display: inline-block;
      background-color: #303030;
      color: #ffffff !important;
      border-radius: 999px;
      font-size: 15px;
      line-height: 15px;
      font-weight: 700;
      padding: 16px 28px;
    }

    .secondary-cta {
      display: inline-block;
      background-color: #fafafa;
      color: #303030 !important;
      border: 1px solid #d9d9d9;
      border-radius: 999px;
      font-size: 14px;
      line-height: 14px;
      font-weight: 600;
      padding: 14px 24px;
    }

    .divider {
      height: 1px;
      background-color: #ebebeb;
      font-size: 0;
      line-height: 0;
    }

    .footer-link {
      font-size: 14px;
      line-height: 22px;
      color: #505050 !important;
    }

    .footer-shell {
      background: linear-gradient(180deg, #2d2827 0%, #241f1f 100%);
      border-radius: 24px 24px 0 0;
      overflow: hidden;
    }

    .footer-brand {
      font-size: 18px;
      line-height: 24px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 0.2px;
    }

    .footer-address {
      font-size: 14px;
      line-height: 22px;
      color: rgba(255, 255, 255, 0.78);
      margin: 0;
    }

    .footer-socialWrap {
      text-align: right;
    }

    .footer-socialLink {
      display: inline-block;
      width: 46px;
      height: 46px;
      border-radius: 999px;
      background-color: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      margin-left: 10px;
    }

    .footer-socialIcon {
      width: 22px;
      height: 22px;
      margin: 11px auto;
    }

    .footer-meta {
      font-size: 12px;
      line-height: 18px;
      color: rgba(255, 255, 255, 0.62);
      text-transform: uppercase;
      letter-spacing: 1.1px;
    }

    .icon-badge {
      width: 54px;
      height: 54px;
      border-radius: 999px;
      background: linear-gradient(135deg, #505050 0%, #303030 100%);
      color: #ffffff;
      font-size: 28px;
      line-height: 54px;
      text-align: center;
      font-weight: 700;
      margin: 0 auto;
    }

    .micro {
      font-size: 11px;
      line-height: 18px;
      color: #8b8b8b;
    }

    @media screen and (max-width: 640px) {
      .container,
      .full {
        width: 100% !important;
      }

      .stack,
      .stack td {
        display: block !important;
        width: 100% !important;
      }

      .px-32 {
        padding-left: 24px !important;
        padding-right: 24px !important;
      }

      .pt-40 {
        padding-top: 28px !important;
      }

      .pb-40 {
        padding-bottom: 28px !important;
      }

      .title {
        font-size: 28px !important;
        line-height: 34px !important;
      }

      .section-title {
        font-size: 22px !important;
        line-height: 28px !important;
      }

      .subtitle {
        font-size: 16px !important;
        line-height: 26px !important;
      }

      .mobile-center {
        text-align: center !important;
      }

      .mobile-pb-24 {
        padding-bottom: 24px !important;
      }

      .mobile-image {
        max-width: 280px !important;
        margin: 0 auto !important;
      }

      .footer-socialWrap {
        text-align: left !important;
      }

      .footer-socialLink {
        margin: 0 10px 0 0 !important;
      }
    }
  </style>
</head>
<body>
  <!--
    PERSONALIZAÇÃO VIA BACKEND / AUTOMAÇÃO
    - {{customer_gender}} = "male"  -> usar Márcio Garcia
    - {{customer_gender}} = "female" -> usar Deborah Secco
    - Rodapé varia por unidade: instagram, facebook, whatsapp e endereço
    - Este template evita JavaScript porque clientes de e-mail normalmente bloqueiam scripts
  -->
  <center class="email-bg">
    <table role="presentation" width="100%" class="email-bg">
      <tr>
        <td align="center" style="padding: 24px 12px;">
          <table role="presentation" width="680" class="container">
            <tr>
              <td class="hero px-32 pt-40" style="padding: 40px 32px 24px 32px;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="center" style="padding-bottom: 24px;">
                      <img src="{{logo_url}}" alt="Espaço Facial" width="290" style="max-width: 290px; width: 100%; height: auto;" />
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom: 18px;">
                      <div class="icon-badge">✓</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom: 14px;">
                      <span class="eyebrow">Confirmação de reserva</span>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom: 14px;">
                      <h1 class="title">SUA RESERVA FOI CONFIRMADA</h1>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom: 24px;">
                      <p class="subtitle">Recebemos seu agendamento com sucesso. Em breve, nossa equipe poderá entrar em contato para confirmar os detalhes.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="px-32" style="padding: 0 32px 24px 32px; background-color: #f2efee;">
                <table role="presentation" width="100%" class="card">
                  <tr>
                    <td style="padding: 28px 28px 16px 28px;">
                      <table role="presentation" width="100%" class="stack">
                        <tr>
                          <td width="56%" valign="top" class="mobile-pb-24">
                            <table role="presentation" width="100%">
                              <tr>
                                <td style="padding-bottom: 18px;">
                                  <h2 class="section-title">Dados da reserva</h2>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 14px;">
                                  <div class="detail-label">Nome</div>
                                  <div class="detail-value">{{customer_name}}</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 14px;">
                                  <div class="detail-label">Procedimento</div>
                                  <div class="detail-value">{{procedure_name}}</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 14px;">
                                  <div class="detail-label">Data</div>
                                  <div class="detail-value">{{appointment_date}}</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 14px;">
                                  <div class="detail-label">Horário</div>
                                  <div class="detail-value">{{appointment_time}}</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 14px;">
                                  <div class="detail-label">Unidade</div>
                                  <div class="detail-value">{{unit_name}}</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td width="44%" valign="bottom" align="right" class="mobile-center">
                            <img src="{{ambassador_image_url}}" alt="{{ambassador_name}}" width="240" class="mobile-image" style="max-width: 240px; border-radius: 12px 12px 0 0;" />
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="px-32" style="padding: 0 32px 24px 32px; background-color: #f2efee;">
                <table role="presentation" width="100%" class="soft-card">
                  <tr>
                    <td style="padding: 24px 24px 18px 24px;">
                      <table role="presentation" width="100%" class="stack">
                        <tr>
                          <td width="50%" valign="top" class="mobile-pb-24">
                            <h3 style="margin: 0 0 10px 0; font-size: 20px; line-height: 26px; color: #303030;">Próximos passos</h3>
                            <p class="body-text">Guarde estas informações e, se necessário, fale com nossa equipe para ajustes ou dúvidas.</p>
                          </td>
                          <td width="50%" valign="top">
                            <table role="presentation" width="100%">
                              <tr>
                                <td style="padding-bottom: 10px;">
                                  <div style="font-size: 14px; line-height: 22px; color: #505050;">• Atendimento com acolhimento e orientação</div>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 10px;">
                                  <div style="font-size: 14px; line-height: 22px; color: #505050;">• Avaliação individual conforme o seu planejamento</div>
                                </td>
                              </tr>
                              <tr>
                                <td>
                                  <div style="font-size: 14px; line-height: 22px; color: #505050;">• Técnica, protocolo e acompanhamento da equipe</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="px-32 pb-40" style="padding: 0 32px 40px 32px; background-color: #f2efee;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="center" style="padding-bottom: 14px;">
                      <a href="{{reservation_details_url}}" class="cta">VER DETALHES DA RESERVA</a>
                    </td>
                  </tr>
                  <tr>
                    <td align="center">
                      <a href="{{team_contact_url}}" class="secondary-cta">FALAR COM A EQUIPE</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="px-32 pb-40" style="padding: 0 32px 32px 32px; background-color: #f2efee;">
                <table role="presentation" width="100%" class="footer-shell">
                  <tr>
                    <td style="padding: 26px 28px 20px 28px;">
                      <table role="presentation" width="100%" class="stack">
                        <tr>
                          <td width="58%" valign="top" class="mobile-pb-24">
                            <img src="{{footer_logo_url}}" alt="Espaço Facial" width="168" style="max-width: 168px; width: 100%; height: auto; margin-bottom: 16px;" />
                            <div class="footer-meta" style="padding-bottom: 8px;">Unidade confirmada</div>
                            <div class="footer-brand" style="padding-bottom: 10px;">{{unit_name}}</div>
                            <p class="footer-address">{{unit_address}}</p>
                          </td>
                          <td width="42%" valign="middle" class="footer-socialWrap">
                            <a href="{{unit_instagram_url}}" class="footer-socialLink" aria-label="Instagram da unidade" title="Instagram da unidade">
                              <img src="{{unit_instagram_icon_url}}" alt="Instagram" class="footer-socialIcon" width="22" height="22" />
                            </a>
                            <a href="{{unit_facebook_url}}" class="footer-socialLink" aria-label="Facebook da unidade" title="Facebook da unidade">
                              <img src="{{unit_facebook_icon_url}}" alt="Facebook" class="footer-socialIcon" width="22" height="22" />
                            </a>
                            <a href="{{unit_whatsapp_url}}" class="footer-socialLink" aria-label="WhatsApp da unidade" title="WhatsApp da unidade">
                              <img src="{{unit_whatsapp_icon_url}}" alt="WhatsApp" class="footer-socialIcon" width="22" height="22" />
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="px-32" style="padding: 0 32px 32px 32px; background-color: #f2efee;">
                <p class="micro">Esta mensagem confirma apenas o recebimento da sua reserva no site. Caso precise ajustar informações, nossa equipe pode orientar você pelos canais da unidade. Resultados variam de pessoa para pessoa e dependem de avaliação individual.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>

`;
