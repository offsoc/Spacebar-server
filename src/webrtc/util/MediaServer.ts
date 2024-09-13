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
import { WebSocket } from "@spacebar/gateway";
import * as mediasoup from "mediasoup";
import { types as MediaSoupTypes } from "mediasoup";
import * as sdpTransform from "sdp-transform";

export const channels = new Map<string, Set<Client>>();
export const workers: MediaSoupTypes.Worker<AppData>[] = [];
export const routers = new Map<string, MediaSoupTypes.Router>();
export let nextWorkerIdx = 0;

export interface Client {
	websocket: WebSocket;
	ssrc: number;
	sdp?: sdpTransform.SessionDescription;
	channel_id: string;
	headerExtensions: MediaSoupTypes.RtpHeaderExtensionParameters[];
	// secret_key?: Uint8Array;
	codecs: Codec[];
	streams: Stream[];
	producers: Map<number, MediaSoupTypes.Producer>;
	consumers: Map<string, MediaSoupTypes.Consumer>;
	transports: {
		producer: MediaSoupTypes.WebRtcTransport;
		consumer?: MediaSoupTypes.WebRtcTransport;
	};
}

export function getClients(channel_id: string) {
	if (!channels.has(channel_id)) channels.set(channel_id, new Set());
	return channels.get(channel_id)!;
}

export function getRouter(channelId: string) {
	return routers.get(channelId);
}

export async function getOrCreateRouter(channel_id: string) {
	if (!routers.has(channel_id)) {
		const worker = getWorker();
		const router = await worker.createRouter({
			mediaCodecs: MEDIA_CODECS,
		});

		routers.set(channel_id, router);
		return router;
	}

	return routers.get(channel_id)!;
}

export function getWorker() {
	const worker = workers[nextWorkerIdx];

	if (++nextWorkerIdx === workers.length) nextWorkerIdx = 0;

	return worker;
}

export async function createWorkers() {
	const numWorkers = 1;

	for (let i = 0; i < numWorkers; i++) {
		const worker = await mediasoup.createWorker({
			logLevel: "debug",
			logTags: [
				"info",
				"ice",
				"dtls",
				"rtp",
				"srtp",
				"rtcp",
				"rtx",
				"bwe",
				"score",
				"simulcast",
				"svc",
				"sctp",
			],
		});

		worker.on("died", () => {
			console.error(
				"mediasoup Worker died, exiting  in 2 seconds... [pid:%d]",
				worker.pid,
			);

			setTimeout(() => process.exit(1), 2000);
		});

		worker.observer.on("newrouter", (router) => {
			console.debug("new router [pid:%d]: %s", worker.pid, router.id);

			router.observer.on("newrtpobserver", (rtpObserver) => {
				console.debug(
					"new RtpObserver [pid:%d]: %s",
					worker.pid,
					rtpObserver.id,
				);
			});

			router.observer.on("newtransport", async (transport) => {
				console.debug(
					"new transport [pid:%d]: %s",
					worker.pid,
					transport.id,
				);

				await transport.enableTraceEvent();

				(transport as MediaSoupTypes.WebRtcTransport).on(
					"iceselectedtuplechange",
					(tuple) => {
						console.log(`transport(iceselectedtuplechange)`, tuple);
					},
				);

				(transport as MediaSoupTypes.WebRtcTransport).on(
					"icestatechange",
					(icestate) => {
						console.log(`transport(ice state change)`, icestate);
					},
				);

				(transport as MediaSoupTypes.WebRtcTransport).on(
					"trace",
					(trace) => {
						console.log(`transport(trace)`, trace);
					},
				);

				(transport as MediaSoupTypes.WebRtcTransport).on(
					"dtlsstatechange",
					(dtlsstate) => {
						console.log(`transport(dtls state change)`, dtlsstate);
					},
				);

				(transport as MediaSoupTypes.WebRtcTransport).on(
					"sctpstatechange",
					(sctpstate) => {
						console.log(`transport(sctp state change)`, sctpstate);
					},
				);

				transport.observer.on("newproducer", (producer) => {
					console.debug(
						"new Producer [pid:%d]: %s",
						worker.pid,
						producer.id,
					);

					producer.on("score", (score) => {
						console.log(`transport producer(score)`, score);
					});

					producer.on("trace", (trace) => {
						console.log(`transport producer(trace)`, trace);
					});

					producer.on("videoorientationchange", (orientation) => {
						console.log(
							`transport producer(videoorientationchange)`,
							orientation,
						);
					});
				});

				transport.observer.on("newconsumer", (consumer) => {
					console.debug(
						"new Consumer [pid:%d]: %s",
						worker.pid,
						consumer.id,
					);

					consumer.on("rtp", (rtpPacket) => {
						console.log(`transport consumer(rtp)`, rtpPacket);
					});

					consumer.on("trace", (trace) => {
						console.log(`transport consumer(trace)`, trace);
					});

					consumer.on("score", (score) => {
						console.log(`transport consumer(score)`, score);
					});

					consumer.on("layerschange", (layers) => {
						console.log(`transport consumer(layerschange)`, layers);
					});
				});
			});
		});

		worker.observer.on("newwebrtcserver", (webRtcServer) => {
			console.debug(
				"new WebRtcServer [pid:%d]: %s",
				worker.pid,
				webRtcServer.id,
			);
		});

		worker.observer.on("close", () => {
			console.debug("mediasoup Worker closed [pid:%d]", worker.pid);
		});

		workers.push(worker);

		// Create a WebRtcServer in this Worker.
		// Each mediasoup Worker will run its own WebRtcServer, so those cannot
		// share the same listening ports. Hence we increase the value in config.js
		// for each Worker.
		const webRtcServerOptions: MediaSoupTypes.WebRtcServerOptions = {
			listenInfos: [
				{
					protocol: "udp",
					ip: "0.0.0.0",
					announcedAddress: "192.168.10.112",
					port: 20000,
				},
			],
		};

		const webRtcServer = await worker.createWebRtcServer(
			webRtcServerOptions,
		);

		worker.appData.webRtcServer = webRtcServer;

		// Log worker resource usage every X seconds.
		// setInterval(async () => {
		// 	const usage = await worker.getResourceUsage();

		// 	console.debug(
		// 		"mediasoup Worker resource usage [pid:%d]: %o",
		// 		worker.pid,
		// 		usage,
		// 	);

		// 	const dump = await worker.dump();

		// 	console.debug(
		// 		"mediasoup Worker dump [pid:%d]: %o",
		// 		worker.pid,
		// 		dump,
		// 	);
		// }, 120000);
	}
}

export interface AppData extends MediaSoupTypes.AppData {
	webRtcServer?: MediaSoupTypes.WebRtcServer;
}

export interface Codec {
	name: "opus" | "VP8" | "VP9" | "H264";
	type: "audio" | "video";
	priority: number;
	payload_type: number;
	rtx_payload_type?: number | null;
}

export const MEDIA_CODECS: MediaSoupTypes.RtpCodecCapability[] = [
	{
		kind: "audio",
		mimeType: "audio/opus",
		clockRate: 48000,
		channels: 2,
		rtcpFeedback: [{ type: "nack" }, { type: "transport-cc" }],
	},
	{
		kind: "audio",
		mimeType: "audio/multiopus",
		clockRate: 48000,
		channels: 4,
		// Quad channel.
		parameters: {
			channel_mapping: "0,1,2,3",
			num_streams: 2,
			coupled_streams: 2,
		},
		rtcpFeedback: [{ type: "nack" }, { type: "transport-cc" }],
	},
	{
		kind: "audio",
		mimeType: "audio/multiopus",
		clockRate: 48000,
		channels: 6,
		// 5.1.
		parameters: {
			channel_mapping: "0,4,1,2,3,5",
			num_streams: 4,
			coupled_streams: 2,
		},
		rtcpFeedback: [{ type: "nack" }, { type: "transport-cc" }],
	},
	{
		kind: "audio",
		mimeType: "audio/multiopus",
		clockRate: 48000,
		channels: 8,
		// 7.1.
		parameters: {
			channel_mapping: "0,6,1,2,3,4,5,7",
			num_streams: 5,
			coupled_streams: 3,
		},
		rtcpFeedback: [{ type: "nack" }, { type: "transport-cc" }],
	},
	{
		kind: "video",
		mimeType: "video/VP8",
		clockRate: 90000,
		rtcpFeedback: [
			{ type: "nack" },
			{ type: "nack", parameter: "pli" },
			{ type: "ccm", parameter: "fir" },
			{ type: "goog-remb" },
			{ type: "transport-cc" },
		],
	},
	{
		kind: "video",
		mimeType: "video/VP9",
		clockRate: 90000,
		rtcpFeedback: [
			{ type: "nack" },
			{ type: "nack", parameter: "pli" },
			{ type: "ccm", parameter: "fir" },
			{ type: "goog-remb" },
			{ type: "transport-cc" },
		],
	},
	{
		kind: "video",
		mimeType: "video/H264",
		clockRate: 90000,
		parameters: {
			"level-asymmetry-allowed": 1,
		},
		rtcpFeedback: [
			{ type: "nack" },
			{ type: "nack", parameter: "pli" },
			{ type: "ccm", parameter: "fir" },
			{ type: "goog-remb" },
			{ type: "transport-cc" },
		],
	},
	{
		kind: "video",
		mimeType: "video/H265",
		clockRate: 90000,
		parameters: {
			"level-asymmetry-allowed": 1,
		},
		rtcpFeedback: [
			{ type: "nack" },
			{ type: "nack", parameter: "pli" },
			{ type: "ccm", parameter: "fir" },
			{ type: "goog-remb" },
			{ type: "transport-cc" },
		],
	},
];

export interface Stream {
	type: string;
	rid: string; //number
	quality: number;
}

export const SUPPORTED_EXTENTIONS = [
	"urn:ietf:params:rtp-hdrext:sdes:mid",
	"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
	"urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
	"http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07",
	"urn:ietf:params:rtp-hdrext:framemarking",
	"urn:ietf:params:rtp-hdrext:ssrc-audio-level",
	"urn:3gpp:video-orientation",
	"urn:ietf:params:rtp-hdrext:toffset",
	"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
	"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
	"http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time",
	"http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
];
