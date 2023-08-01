'use strict';

import moleculer, { Context, ServiceBroker } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { launch } from 'puppeteer';
const { readFileSync } = require('fs');
import * as ejs from 'ejs';

@Service({
  name: 'pdf',
  settings: {
    puppeteerArgs: { headless: true, args: ['--no-sandbox'] },
    options: {
      width: '620px',
      height: '877px',
      timeout: 1000 * 60 * 10, // 10 minutes (in ms)
      displayHeaderFooter: true,
      footerTemplate: '<span></span>',
      headerTemplate: '<span></span>',
      margin: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50,
      },
    },
    remoteContent: true,
  },
})
export default class PdfService extends moleculer.Service {
  @Action({
    params: {
      template: 'string',
      variables: 'any',
    },
    timeout: 0,
  })
  async generate(
    ctx: Context<{ variables: Object; template: string; footer?: string }>
  ) {
    const { template, variables, footer } = ctx.params;

    const html: string = await ctx.call('pdf.html', { variables, template });
    const footerTemplate: string = footer
      ? await ctx.call('pdf.html', { template: footer, variables })
      : '';

    const { puppeteerArgs, options, remoteContent } = this.settings;

    const browser = await launch(puppeteerArgs);

    const page = await browser.newPage();

    if (!!remoteContent) {
      await page.goto('data:text/html,<h1>Template</h1>', {
        waitUntil: 'networkidle0',
      });

      await page.setContent(html);

      await page.waitForNetworkIdle({
        idleTime: 3000,
      });
    } else {
      await page.setContent(html);
    }

    const result = await page.pdf({ ...options, footerTemplate });
    await browser.close();

    return result;
  }

  @Action({
    params: {
      template: 'string',
      variables: {
        type: 'any',
        optional: true,
      },
    },
    timeout: 0,
  })
  async html(ctx: Context<{ variables: Object; template: string }>) {
    const { template, variables } = ctx.params;

    const rootPath = './templates';
    const templateHtml = await readFileSync(`${rootPath}/${template}`, 'utf8');

    const html = ejs.render(templateHtml, variables, {
      views: [rootPath],
    });

    return html;
  }
}
