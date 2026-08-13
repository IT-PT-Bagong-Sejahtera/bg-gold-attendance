const base = require("./app.json").expo;

module.exports = () => ({
  ...base,
  android: {
    ...base.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  plugins: [
    ...(base.plugins || []),
    [
      "./plugins/withBGGoldIntegrity",
      {
        cloudProjectNumber:
          process.env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER || "0",
      },
    ],
  ],
});
