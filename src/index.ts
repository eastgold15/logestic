/**
 * @module logestic
 * @description This module provides a class to configure and perform logging.
 */

import fs from "node:fs";
import type { BunFile } from "bun";

import c from "chalk";
import Elysia from "elysia";
import type {
	DefinitionBase,
	EphemeralType,
	MetadataBase,
	RouteBase,
	SingletonBase,
} from "elysia/dist/types";
import { getPreset } from "./presets";
import type {
	Attribute,
	Callback,
	LogesticOptions,
	LogLevelColour,
	Preset,
} from "./types";
import { buildAttrs, colourLogType, removeAnsi } from "./utils";

export type { Attribute, LogesticOptions };
export const chalk = c; // Re-export chalk for custom formatting

/**
 * Logestic class provides methods to configure and perform logging.
 */
export class Logestic<K extends keyof Attribute = keyof Attribute> {
	private requestedAttrs: K[];
	// 蒸馏
	private dest!: BunFile;
	// 显示层级
	private showLevel: boolean;
	// 日志层级颜色
	private logLevelColour: LogLevelColour;
	private httpLogging: boolean;
	private explicitLogging: boolean;

	/**
	 * Creates a new Logestic instance.
	 *
	 * @param options - The options to configure the Logestic instance.
	 * @see LogesticOptions
	 */
	constructor(options: LogesticOptions = {}) {
		this.requestedAttrs = [];
		this.showLevel = options.showLevel || false;
		this.logLevelColour = options.logLevelColour || {};
		this.httpLogging = options.httpLogging || true;
		this.explicitLogging = options.explicitLogging || true;

		this.setDest(options.dest || Bun.stdout);
	}

	private setDest(dest: BunFile): void {
		if (dest === Bun.stdin) {
			// Cannot log to stdin
			throw new Error(
				"Cannot log to stdin. Please provide a writable destination.",
			);
		}
		if (dest === Bun.stdout || dest === Bun.stderr) {
			// Use stdout or stderr
			this.dest = dest;
			return;
		}

		// Custom file destination
		this.createFileIfNotExists(dest)
			.then((file) => {
				this.dest = file;
			})
			.catch((err) => {
				throw err;
			});
	}

	private async createFileIfNotExists(dest: BunFile): Promise<BunFile> {
		if (!(await dest.exists())) {
			Bun.write(dest, "");
		}
		return dest;
	}

	/**
	 * Requests Logestic to provide a particular attribute.
	 * @param attrs - An attribute key or an array of attribute keys.
	 * @returns The Logestic instance for chaining.
	 */
	use<NK extends K>(attr: NK): Logestic<NK>;
	use<NK extends K>(attrs: NK[]): Logestic<NK>;
	use<NK extends K>(attrs: NK | NK[]): Logestic<NK> {
		if (Array.isArray(attrs)) {
			for (const attr of attrs) {
				this._use(attr);
			}
			return this as unknown as Logestic<NK>;
		}

		// Single attribute
		this._use(attrs);
		return this as unknown as Logestic<NK>;
	}

	private _use(attr: K) {
		this.requestedAttrs.push(attr);
	}

	/**
	 * @param name The name of the preset to use.
	 * @param options The options to configure the preset. Any options provided will override the preset's default options.
	 * @returns A new Elysia instance with the logger plugged in.
	 */
	static preset<
		T extends Elysia<
			string,
			boolean,
			SingletonBase,
			DefinitionBase,
			MetadataBase,
			RouteBase,
			EphemeralType,
			EphemeralType
		>,
	>(name: Preset, options: LogesticOptions = {}) {
		return getPreset(name)(options) as unknown as T;
	}

	/**
	 * Use this when you do not want any http logging.
	 *
	 * @returns Elysia instance with the logger plugged in.
	 */
	build(this: Logestic) {
		return new Elysia({
			name: "logestic",
		}).decorate("logestic", this);
	}

	/**
	 * Successful requests will not log if httpLogging is disabled.
	 * Error logs will always be logged regardless.
	 *
	 * @param formatAttr - The format object containing functions to format successful and failed logs.
	 * @returns Elysia instance with the logger plugged in.
	 */
	format(this: Logestic, formatAttr: Callback<K>) {
		return this.build()
			.state("logestic_timeStart", 0n)
			.onRequest(({ store, request }) => {
				store.logestic_timeStart = process.hrtime.bigint();

				if (formatAttr.onRequest) {
					let msg = formatAttr.onRequest(request);
					if (this.showLevel) {
						msg = `${colourLogType("http", this.logLevelColour)} ${msg}`;
					}
					this.log(msg);
				}
			})
			.onAfterResponse({ as: "global" }, (ctx) => {
				if (!this.httpLogging) {
					return;
				}

				// get attributes, format and log
				const {
					store: { logestic_timeStart },
				} = ctx;
				const attrs = buildAttrs(ctx, this.requestedAttrs, logestic_timeStart);
				let msg = formatAttr.onSuccess(attrs);
				if (this.showLevel) {
					msg = `${colourLogType("http", this.logLevelColour)} ${msg}`;
				}
				this.log(msg);
			})
			.onError({ as: "global" }, ({ request, error, code }) => {
				const datetime = new Date();
				let msg = formatAttr.onFailure({ request, error, code, datetime });
				if (this.showLevel) {
					msg = `${colourLogType("error", this.logLevelColour)} ${msg}`;
				}
				this.log(msg);
			});
	}

	private async log(msg: string): Promise<void> {
		// ignore empty logs
		if (!msg || msg === "") return;

		const msgNewLine = `${msg}\n`;
		if (!this.dest.name || !this.dest.name.length) {
			// This is either stdout or stderr
			Bun.write(this.dest, msgNewLine);
			return;
		}

		const sanitised = removeAnsi(msgNewLine);
		fs.appendFile(this.dest.name, sanitised, (err) => {
			if (err) {
				throw err;
			}
		});
	}

	/**
	 * Logs an info message to the destination.
	 *
	 * @param msg The message to log.
	 */
	info(msg: string): void {
		if (!this.explicitLogging) {
			return;
		}

		let _msg = msg;
		if (this.showLevel) {
			_msg = `${colourLogType("info", this.logLevelColour)} ${msg}`;
		}
		this.log(_msg);
	}

	/**
	 * Logs a warning message to the destination.
	 *
	 * @param msg The message to log.
	 */
	warn(msg: string): void {
		if (!this.explicitLogging) {
			return;
		}

		let _msg = msg;
		if (this.showLevel) {
			_msg = `${colourLogType("warn", this.logLevelColour)} ${msg}`;
		}
		this.log(_msg);
	}

	/**
	 * Logs a debug message to the destination.
	 *
	 * @param msg The message to log.
	 */
	debug(msg: string): void {
		if (!this.explicitLogging) {
			return;
		}

		let _msg = msg;
		if (this.showLevel) {
			_msg = `${colourLogType("debug", this.logLevelColour)} ${msg}`;
		}
		this.log(_msg);
	}

	/**
	 * Logs an error message to the destination.
	 *
	 * @param msg The message to log.
	 */
	error(msg: string): void {
		if (!this.explicitLogging) {
			return;
		}

		let _msg = msg;
		if (this.showLevel) {
			_msg = `${colourLogType("error", this.logLevelColour)} ${msg}`;
		}
		this.log(_msg);
	}
}
