import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

export interface EmailMensagem {
  para: string;
  assunto: string;
  texto: string;
}

/** Porta de envio de e-mail: trocar o provedor so mexe no adaptador escolhido em PortalModule. */
export interface EmailPort {
  enviar(msg: EmailMensagem): Promise<void>;
}
export const EMAIL_PORT = Symbol('EMAIL_PORT');

/** SMTP via nodemailer (Mailpit local no docker-compose; em producao, qualquer SMTP com plano gratuito). */
export class SmtpEmailSender implements EmailPort {
  private readonly transporte;
  constructor(smtpUrl: string, private readonly de: string) {
    this.transporte = createTransport(smtpUrl);
  }
  async enviar(msg: EmailMensagem): Promise<void> {
    await this.transporte.sendMail({ from: this.de, to: msg.para, subject: msg.assunto, text: msg.texto });
  }
}

/**
 * Sem SMTP (so fora de producao): registra o e-mail no log para a demo funcionar sem provedor.
 * Atencao: o texto contem o link de acesso; por isso este adaptador e proibido em producao (ver env.ts).
 */
export class LogEmailSender implements EmailPort {
  private readonly log = new Logger('Email');
  async enviar(msg: EmailMensagem): Promise<void> {
    this.log.warn(`E-mail (nao enviado, sem SMTP_URL) para ${msg.para}: ${msg.assunto}\n${msg.texto}`);
  }
}
