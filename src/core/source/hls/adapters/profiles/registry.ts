import { fmp4HLSProfile } from "./fmp4";
import { standardHLSProfile } from "./standard";
import { HLSProfileAdapter } from "./types";

export const hlsProfiles: readonly HLSProfileAdapter[] = [fmp4HLSProfile, standardHLSProfile];
