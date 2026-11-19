import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Universal Browser Agent',
    description: 'Model-agnostic browser control for AI agents via direct DOM access.',
    version: '0.1.0',
    permissions: [
      'storage',
      'tabs',
      'scripting',
      'activeTab',
      'nativeMessaging'
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
