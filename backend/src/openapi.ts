import { APP_NAME } from '@nexa/shared';

const json = { 'application/json': { schema: { type: 'object' } } };
const ok = { description: 'Success', content: json };
const noContent = { description: 'No content' };
const errorResponses = {
  '400': { description: 'Invalid input', content: json },
  '401': { description: 'Authentication required', content: json },
  '403': { description: 'Forbidden', content: json },
  '429': { description: 'Rate limited', content: json },
};
const secured = [{ cookieSession: [] }, { bearerAuth: [] }];
const body = { required: true, content: json };

function read(summary: string, tags: string[]) {
  return { summary, tags, security: secured, responses: { '200': ok, ...errorResponses } };
}
function create(summary: string, tags: string[], status = '201') {
  return {
    summary,
    tags,
    security: secured,
    requestBody: body,
    responses: { [status]: ok, ...errorResponses },
  };
}
function mutate(summary: string, tags: string[]) {
  return {
    summary,
    tags,
    security: secured,
    requestBody: body,
    responses: { '200': ok, '204': noContent, ...errorResponses },
  };
}

export const openApi = {
  openapi: '3.1.0',
  info: {
    title: `${APP_NAME} API`,
    version: '0.1.0',
    description:
      'Cloudflare Workers API for NEXA. Mutations authenticated by cookies also require X-CSRF-Token.',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [
    { url: 'https://nexa-api.nexaapp.workers.dev/v1' },
    { url: 'http://localhost:8787/v1' },
  ],
  tags: [
    { name: 'Auth' },
    { name: 'Social' },
    { name: 'Communities' },
    { name: 'Messaging' },
    { name: 'Media' },
    { name: 'Moderation' },
  ],
  components: {
    securitySchemes: {
      cookieSession: { type: 'apiKey', in: 'cookie', name: 'nexa_access' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
              details: {},
            },
          },
        },
      },
    },
  },
  paths: {
    '/auth/register': {
      post: { ...create('Register an age-eligible account', ['Auth']), security: [] },
    },
    '/auth/login': {
      post: { ...create('Create a rotating session', ['Auth'], '200'), security: [] },
    },
    '/auth/refresh': {
      post: { ...create('Rotate refresh and access tokens', ['Auth'], '200'), security: [] },
    },
    '/auth/logout': { post: mutate('Revoke the current session', ['Auth']) },
    '/auth/me': {
      get: read('Get the current account', ['Auth']),
      patch: mutate('Update profile', ['Auth']),
      delete: mutate('Delete the account and content', ['Auth']),
    },
    '/auth/sessions': {
      get: read('List active sessions', ['Auth']),
      delete: mutate('Revoke all sessions', ['Auth']),
    },
    '/auth/totp/setup': { post: create('Begin TOTP setup', ['Auth'], '200') },
    '/auth/totp/enable': { post: mutate('Confirm and enable TOTP', ['Auth']) },
    '/auth/export': { get: read('Export account data', ['Auth']) },
    '/feed': { get: read('Cursor-paginated personalized feed', ['Social']) },
    '/posts': { post: create('Create a post', ['Social']) },
    '/posts/{postId}': {
      get: read('Get a post', ['Social']),
      patch: mutate('Edit a post', ['Social']),
      delete: mutate('Delete a post', ['Social']),
    },
    '/posts/{postId}/likes': {
      post: mutate('Like a post', ['Social']),
      delete: mutate('Remove a post like', ['Social']),
    },
    '/posts/{postId}/comments': {
      get: read('List nested comments', ['Social']),
      post: create('Create a comment', ['Social']),
    },
    '/users/{userId}': { get: read('Get a privacy-filtered profile', ['Social']) },
    '/users/{userId}/follow': {
      post: mutate('Follow a user', ['Social']),
      delete: mutate('Unfollow a user', ['Social']),
    },
    '/users/{userId}/block': {
      post: mutate('Block a user', ['Moderation']),
      delete: mutate('Unblock a user', ['Moderation']),
    },
    '/search': { get: read('Search people, posts, and public communities', ['Social']) },
    '/notifications': { get: read('List notifications', ['Social']) },
    '/reports': { post: create('Report content or a user', ['Moderation']) },
    '/servers': {
      get: read('List joined communities', ['Communities']),
      post: create('Create a community', ['Communities']),
    },
    '/servers/{serverId}': {
      get: read('Get visible channels, roles, and settings', ['Communities']),
      patch: mutate('Update a community', ['Communities']),
      delete: mutate('Delete an owned community', ['Communities']),
    },
    '/servers/{serverId}/channels': { post: create('Create a channel', ['Communities']) },
    '/channels/{channelId}': {
      patch: mutate('Update channel and slow mode', ['Communities']),
      delete: mutate('Delete a channel', ['Communities']),
    },
    '/servers/{serverId}/roles': { post: create('Create a permission role', ['Communities']) },
    '/servers/{serverId}/invites': { post: create('Create a bounded invite', ['Communities']) },
    '/invites/{code}/join': { post: mutate('Join through an invite', ['Communities']) },
    '/servers/{serverId}/bans/{userId}': {
      post: mutate('Ban a member', ['Moderation']),
      delete: mutate('Remove a ban', ['Moderation']),
    },
    '/servers/{serverId}/audit-log': { get: read('Read moderation audit entries', ['Moderation']) },
    '/conversations': {
      get: read('List direct and group conversations', ['Messaging']),
      post: create('Create a conversation', ['Messaging']),
    },
    '/channels/{channelId}/messages': {
      get: read('List channel messages by cursor', ['Messaging']),
      post: create('Send an idempotent channel message', ['Messaging']),
    },
    '/conversations/{conversationId}/messages': {
      get: read('List private messages by cursor', ['Messaging']),
      post: create('Send an idempotent private message', ['Messaging']),
    },
    '/messages/{messageId}': {
      patch: mutate('Edit an authored message', ['Messaging']),
      delete: mutate('Delete an authorized message', ['Messaging']),
    },
    '/messages/{messageId}/reactions': { post: mutate('Add a message reaction', ['Messaging']) },
    '/messages/{messageId}/forward': {
      post: create('Forward an accessible message', ['Messaging']),
    },
    '/messages/search': { get: read('Search within one authorized room', ['Messaging']) },
    '/uploads': { post: create('Upload inspected and metadata-stripped media', ['Media']) },
    '/media/{objectKey}': {
      get: { ...read('Read public or authorized private media', ['Media']), security: [] },
    },
    '/realtime/{kind}/{roomId}': {
      get: {
        summary: 'Upgrade to an authenticated WebSocket',
        tags: ['Messaging'],
        security: secured,
        responses: { '101': { description: 'WebSocket connected' }, ...errorResponses },
      },
    },
  },
} as const;
