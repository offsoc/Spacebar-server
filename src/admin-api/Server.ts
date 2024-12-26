/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import {
	Config,
	ConnectionLoader,
	Email,
	JSONReplacer,
	Sentry,
	initDatabase,
	initEvent,
	registerRoutes,
} from "@spacebar/util";
import { Request, Response, Router, IRoute, Application } from "express";
import { Server, ServerOptions } from "lambert-server";
import "missing-native-js-functions";
import morgan from "morgan";
import path from "path";
import { red } from "picocolors";
import { Authentication, CORS, ImageProxy } from "./middlewares/";
import { BodyParser } from "./middlewares/BodyParser";
import { ErrorHandler } from "./middlewares/ErrorHandler";
import { initRateLimits } from "./middlewares/RateLimit";
import { initTranslation } from "./middlewares/Translation";
import * as console from "node:console";
import fs from "fs/promises";
import { Dirent } from "node:fs";

const PUBLIC_ASSETS_FOLDER = path.join(
	__dirname,
	"..",
	"..",
	"assets",
	"public",
);

export type SpacebarServerOptions = ServerOptions;

// declare global {
// 	eslint-disable-next-line @typescript-eslint/no-namespace
	// namespace Express {
	// 	interface Request {
	// 		server: AdminApiServer;
	// 	}
	// }
// }

export class AdminApiServer extends Server {
	public declare options: SpacebarServerOptions;

	constructor(opts?: Partial<SpacebarServerOptions>) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		super({ ...opts, errorHandler: false, jsonBody: false });
	}

	async start() {
		console.log("[AdminAPI] Starting...");
		await initDatabase();
		await Config.init();
		await initEvent();
		await Sentry.init(this.app);

		const logRequests = process.env["LOG_REQUESTS"] != undefined;
		if (logRequests) {
			this.app.use(
				morgan("combined", {
					skip: (req, res) => {
						let skip = !(
							process.env["LOG_REQUESTS"]?.includes(
								res.statusCode.toString(),
							) ?? false
						);
						if (process.env["LOG_REQUESTS"]?.charAt(0) == "-")
							skip = !skip;
						return skip;
					},
				}),
			);
		}

		this.app.set("json replacer", JSONReplacer);

		const trustedProxies = Config.get().security.trustedProxies;
		if (trustedProxies) this.app.set("trust proxy", trustedProxies);

		this.app.use(CORS);
		this.app.use(BodyParser({ inflate: true, limit: "10mb" }));

		const app = this.app;
		const api = Router();
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		this.app = api;

		// api.use(Authentication);
		// await initRateLimits(api);
		// await initTranslation(api);

		// this.routes = await registerRoutes(
		// 	this,
		// 	path.join(__dirname, "routes", "/"),
		// );

		await this.registerControllers(app, path.join(__dirname, "routes", "/"));

		// fall /v1/api back to /v0/api without redirect
		app.use("/_spacebar/admin/:version/:path", (req, res) => {
			console.log(req.params);
			const versionNumber = req.params.version
				.replace("v", "")
				.toNumber();
			const found = [];
			for (let i = versionNumber; i >= 0; i--) {
				// const oroutes = this.app._router.stack.filter(
				// 	(x: IRoute) =>
				// 		x.path == `/_spacebar/admin/v${i}/${req.params.path}`,
				// );
				const routes = this.routes.map(
					(x: Router) =>
						x.stack.filter(y =>
								y.path == `/_spacebar/admin/v${i}/${req.params.path}`
						),
				).filter(x => x.length > 0);
				console.log(i, routes);
				found.push(...routes);
			}
			res.json({ versionNumber, routes: found });
		});
		// 404 is not an error in express, so this should not be an error middleware
		// this is a fine place to put the 404 handler because its after we register the routes
		// and since its not an error middleware, our error handler below still works.
		api.use("*", (req: Request, res: Response) => {
			res.status(404).json({
				message: "404 endpoint not found",
				code: 0,
			});
		});

		this.app = app;

		app.use("/_spacebar/admin/", api);

		this.app.use(ErrorHandler);

		Sentry.errorHandler(this.app);

		ConnectionLoader.loadConnections();

		if (logRequests)
			console.log(
				red(
					`Warning: Request logging is enabled! This will spam your console!\nTo disable this, unset the 'LOG_REQUESTS' environment variable!`,
				),
			);

		console.log("[AdminAPI] Listening...");
		return super.start();
	}

	private async registerControllers(app: Application, root: string) {
		// get files recursively
		const fsEntries = (await fs.readdir(root, { withFileTypes: true }));
		for (const file of fsEntries.filter(x=>x.isFile() && (x.name.endsWith(".js") || x.name.endsWith(".ts")))) {
			const fullPath = path.join(file.parentPath, file.name);
			const controller = require(fullPath);
			console.log(fullPath, controller);

		}

		for (const dir of fsEntries.filter(x=>x.isDirectory())) {
			await this.registerControllers(app, path.join(dir.parentPath, dir.name));
		}
	}
}
