import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Universal Browser Agent',
    description: 'Model-agnostic browser control for AI agents via direct DOM access.',
    version: '0.1.0',
    // 固定扩展 ID（ecpooakhjpoobkfjnkcjfmbnbdbnjhbh）：保证原生消息 host 的 allowed_origins 稳定，
    // 让「一键启用」脚本无需每次读取扩展 ID。此 key 为 RSA 公钥 SPKI DER 的 base64 编码。
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1WA32SCmNWylCQ04NHxVoIQja9MPdiITT3IcFJrJKqs+ku7C/le2jUUHLIWZrEunA7LVt+NVgCWytuPnYEQ4XYEtT1pp+JwfUKi7dYzoiAEzd/9kyiqCmekdf9SlNmeudB3oZW6h9Vnxnft+hpHyLKZ1XDuu0IsYdFot6smIi7+/VE79aPPrX/ly7FOY+Bb8wwX9ovoQwslMiwZsPTRhsCPBOo3Vdrvzj3vIGr2u8ABBTRzqsK6CLXpX6L+Yq1Ec733QhhB+Gf4EOhi1D49AGXrS92ZgykJ9a6jXR6k8Bn+y08MZk/6yNPkK/rOVLMWpoF0goAACD152mTKZKzf0FwIDAQAB',
    permissions: [
      'storage',
      'tabs',
      'scripting',
      'activeTab',
      'nativeMessaging',
      'alarms'
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Universal Browser Agent'
    },
    background: {
      service_worker: 'background.js'
    }
  }
});
