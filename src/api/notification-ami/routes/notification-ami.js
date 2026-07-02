'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/notification-amis',
      handler: 'notification-ami.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/notification-amis/unsubscribe',
      handler: 'notification-ami.unsubscribe',
      config: {
        auth: false,
      },
    },
  ],
};
