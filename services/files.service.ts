'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { throwNotFoundError } from '../types';
import { UserAuthMeta } from './api.service';
const minio = require('minio');

const minioClient = new minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USESSL === 'true',
  accessKey: process.env.MINIO_ACCESSKEY,
  secretKey: process.env.MINIO_SECRETKEY,
});

const availableFileExtensions: any = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

@Service({
  name: 'files',
})
export default class FilesService extends moleculer.Service {
  @Action()
  async save(
    ctx: Context<
      { id?: string; resume: any },
      UserAuthMeta & { mimetype: string; filename: string }
    >
  ) {
    const fileExtension = this.getFileExtension(ctx.meta.mimetype);
    if (!fileExtension) {
      ctx.params.resume();
      return {
        success: false,
        message: `Cannot upload "${ctx.meta.filename}" file of ${ctx.meta.mimetype} format`,
      };
    }

    const filePath = `${this.getFilePath(
      ctx.meta.user,
      ctx.params.id
    )}.${fileExtension}`;
    await minioClient.putObject(this.getBucket(), filePath, ctx.params);
    const stat = await minioClient.statObject(this.getBucket(), filePath);

    return {
      success: true,
      size: stat.size,
      filename: ctx.meta.filename,
      url: `/${filePath}`,
    };
  }

  @Action({
    params: {
      path: 'string',
      name: 'string',
      buffer: 'any',
    },
  })
  async uploadBuffer(
    ctx: Context<{ path: string; name: string; buffer: any }>
  ) {
    const { path, name: fileName, buffer } = ctx.params;
    const filePath = `${path}/${fileName}`;
    await minioClient.putObject(this.getBucket(), filePath, buffer);
    const stat = await minioClient.statObject(this.getBucket(), filePath);

    return {
      success: true,
      size: stat.size,
      filename: fileName,
      url: `/${filePath}`,
    };
  }

  @Action({
    params: {
      name: 'array',
    },
  })
  async get(ctx: Context<{ name: string[] }, { $responseHeaders: any }>) {
    try {
      const result = await minioClient.getObject(
        this.getBucket(),
        ctx.params.name.join('/')
      );
      const filenames = ctx.params.name[ctx.params.name.length - 1]?.split('.');
      const extension = filenames[filenames.length - 1];
      if (!extension || !availableFileExtensions[extension]) throw new Error();

      ctx.meta.$responseHeaders = {
        'Content-Type': availableFileExtensions[extension],
      };
      return result;
    } catch (err) {
      return throwNotFoundError('File not found.');
    }
  }

  @Action({
    params: {
      name: 'string',
    },
  })
  async remove(ctx: Context<{ name: string[] }>) {
    try {
      const result = await minioClient.removeObject(
        this.getBucket(),
        ctx.params.name
      );

      return result;
    } catch (err) {
      return throwNotFoundError('File not found.');
    }
  }

  @Method
  getBucket() {
    return process.env.MINIO_BUCKET || 'rusys';
  }

  @Method
  getFilePath(user: any, id: string) {
    function makeid(length: number = 30) {
      let result = '';
      const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for (var i = 0; i < length; i++) {
        result += characters.charAt(
          Math.floor(Math.random() * charactersLength)
        );
      }
      return result;
    }

    return `${user?.id || 'somebody'}/${id || makeid()}`;
  }

  @Method
  getFileExtension(mimetype: string) {
    const extension = Object.entries(availableFileExtensions).find(
      ([_, type]: any) => type === mimetype
    );

    return extension?.[0];
  }

  created() {
    if (!process.env.MINIO_ACCESSKEY || !process.env.MINIO_SECRETKEY) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
