module.exports = {
  apps: [
    {
      name: "EquityResearch-backend-new",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 5003,
      },
    },
  ],
};
