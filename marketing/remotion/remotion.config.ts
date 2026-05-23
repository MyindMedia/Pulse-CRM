import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// H.264 mp4 by default; quality bump for hero crispness.
Config.setCodec("h264");
Config.setCrf(18);
