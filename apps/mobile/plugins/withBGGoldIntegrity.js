const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

const META_DATA_NAME = "com.bggold.integrity.CLOUD_PROJECT_NUMBER";

module.exports = function withBGGoldIntegrity(config, options = {}) {
  return withAndroidManifest(config, (result) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      result.modResults,
    );
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      META_DATA_NAME,
      String(options.cloudProjectNumber || "0"),
    );
    return result;
  });
};
