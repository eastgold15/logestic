import type { Preset } from "../types";
import common from "./common";
import commontz from "./commontz";
import fancy from "./fancy";

export const getPreset = (preset: Preset) => {
	switch (preset) {
		case "common":
			return common;
		case "fancy":
			return fancy;
		case "commontz":
			return commontz;
	}
};
