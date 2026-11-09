// Netlify Edge Function: a Hibira waiting room in front of the paths in
// `config.path` below. Visitors without a valid pass go to the hosted
// queue page; when it's their turn they come back with a signed pass, which
// is checked here and kept in an HttpOnly cookie.
//
// Set HIBIRA_KEY and HIBIRA_SECRET (and HIBIRA_ROOM) in Site configuration →
// Environment variables, scoped to Functions.
import { protect } from '@hibira-io/waiting-room/server';

export default async (request, context) => {
  const blocked = await protect(request, {
    appKey: Netlify.env.get('HIBIRA_KEY'),
    secret: [Netlify.env.get('HIBIRA_SECRET'), Netlify.env.get('HIBIRA_PREVIOUS_SECRET')].filter(Boolean),
    room: Netlify.env.get('HIBIRA_ROOM') ?? 'presale',
    lang: Netlify.env.get('HIBIRA_LANG') || undefined,
  });
  return blocked ?? context.next();
};

export const config = {
  path: ['/drop', '/drop/*'],
  // Static assets the protected page needs can stay outside the queue.
  excludedPath: ['/drop/*.css', '/drop/*.js', '/drop/*.png', '/drop/*.svg', '/drop/*.woff2'],
};
