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

import { Payload, Send, WebSocket } from "@spacebar/gateway";
import { validateSchema, VoiceVideoSchema } from "@spacebar/util";
import { types as MediaSoupTypes } from "mediasoup";
import { getClients, getRouter, VoiceOPCodes } from "../util";

// request:
// {
// 	"audio_ssrc": 0,
// 	"rtx_ssrc": 197,
// 	"streams": [
// 		{
// 			"active": false,
// 			"max_bitrate": 2500000,
// 			"max_framerate": 30,
// 			"max_resolution": {
// 				"height": 720,
// 				"type": "fixed",
// 				"width": 1280
// 			},
// 			"quality": 100,
// 			"rid": "100",
// 			"rtx_ssrc": 197,
// 			"ssrc": 196,
// 			"type": "video"
// 		}
// 	],
// 	"video_ssrc": 196
// }

export async function onVideo(this: WebSocket, payload: Payload) {
	if (!this.client) return;
	const { channel_id } = this.client;
	const d = validateSchema("VoiceVideoSchema", payload.d) as VoiceVideoSchema;
	console.log(d);

	await Send(this, { op: VoiceOPCodes.MEDIA_SINK_WANTS, d: { any: 100 } });

	const router = getRouter(channel_id);
	if (!router) {
		console.error(`router not found`);
		return;
	}

	this.client.producers.forEach((producer) => producer.close());
	this.client.consumers.forEach((consumer) => consumer.close());

	// const producer = await this.client.transports.producer.produce({
	// 	kind: "audio",
	// 	rtpParameters: {
	// 		codecs: this.client.codecs
	// 			.filter((x) => x.type === "audio")
	// 			.map((x) => {
	// 				const a = MEDIA_CODECS.find(
	// 					(y) =>
	// 						y.kind === "audio" && y.mimeType.endsWith(x.name),
	// 				);

	// 				return {
	// 					clockRate: a!.clockRate,
	// 					mimeType: a!.mimeType,
	// 					payloadType: x.payload_type,
	// 					channels: a?.channels,
	// 					parameters: a?.parameters,
	// 					rtcpFeedback: a?.rtcpFeedback,
	// 				};
	// 			}),
	// 		encodings: [
	// 			{
	// 				ssrc: d.audio_ssrc,
	// 			},
	// 		],
	// 		headerExtensions: this.client.headerExtensions,
	// 	},
	// 	paused: false,
	// });

	let videoProducer: MediaSoupTypes.Producer | null = null;
	// if (d.video_ssrc !== 0) {
	// 	videoProducer = await this.client.transports.producer.produce({
	// 		kind: "video",
	// 		rtpParameters: {
	// 			codecs: [
	// 				...this.client.codecs
	// 					.filter((x) => x.type === "video")
	// 					.map((x) => {
	// 						const a = MEDIA_CODECS.find(
	// 							(y) =>
	// 								y.kind === "video" &&
	// 								y.mimeType.endsWith(x.name),
	// 						);

	// 						return {
	// 							clockRate: a!.clockRate,
	// 							mimeType: a!.mimeType,
	// 							payloadType: x.payload_type,
	// 							channels: a?.channels,
	// 							parameters: a?.parameters,
	// 							rtcpFeedback: a?.rtcpFeedback,
	// 						};
	// 					}),
	// 				// {
	// 				// 	payloadType: 126,
	// 				// 	mimeType: "video/H264",
	// 				// 	clockRate: 90000,
	// 				// 	parameters: {
	// 				// 		"level-asymmetry-allowed": 1,
	// 				// 	},
	// 				// 	rtcpFeedback: [
	// 				// 		{ type: "nack" },
	// 				// 		{ type: "nack", parameter: "pli" },
	// 				// 		{ type: "ccm", parameter: "fir" },
	// 				// 		{ type: "goog-remb" },
	// 				// 		{ type: "transport-cc" },
	// 				// 	],
	// 				// },
	// 				// {
	// 				// 	payloadType: 120,
	// 				// 	mimeType: "video/VP8",
	// 				// 	clockRate: 90000,
	// 				// 	rtcpFeedback: [
	// 				// 		{ type: "nack" },
	// 				// 		{ type: "nack", parameter: "pli" },
	// 				// 		{ type: "ccm", parameter: "fir" },
	// 				// 		{ type: "goog-remb" },
	// 				// 		{ type: "transport-cc" },
	// 				// 	],
	// 				// },
	// 				// ...this.client.codecs
	// 				// 	.filter((x) => x.type === "video")
	// 				// 	.map((x) => {
	// 				// 		const a = MEDIA_CODECS.find(
	// 				// 			(y) =>
	// 				// 				y.kind === "video" &&
	// 				// 				y.mimeType.endsWith(x.name),
	// 				// 		);

	// 				// 		return {
	// 				// 			mimeType: "video/rtx",
	// 				// 			clockRate: a!.clockRate,
	// 				// 			payloadType: x.rtx_payload_type!,
	// 				// 			parameters: {
	// 				// 				apt: x.payload_type,
	// 				// 			},
	// 				// 		};
	// 				// 	}),
	// 				// {
	// 				// 	payloadType: 127,
	// 				// 	mimeType: "video/rtx",
	// 				// 	clockRate: 90000,
	// 				// 	parameters: {
	// 				// 		apt: 126,
	// 				// 	},
	// 				// },
	// 			],

	// 			encodings: [
	// 				{
	// 					ssrc: d.video_ssrc,
	// 					// rtx: { ssrc: d.rtx_ssrc! },
	// 					// codecPayloadType: 126,
	// 					// rid: d.streams![0].rid,
	// 				},
	// 				// ...this.client.codecs.map((x) => ({
	// 				// 	ssrc: d.video_ssrc,
	// 				// 	codecPayloadType: x.payload_type,
	// 				// })),
	// 			],
	// 			headerExtensions: this.client.headerExtensions,
	// 		},
	// 		paused: false,
	// 	});

	// 	console.log(await videoProducer.dump());

	// 	videoProducer.enableTraceEvent([
	// 		"fir",
	// 		"keyframe",
	// 		"nack",
	// 		"pli",
	// 		"rtp",
	// 		"sr",
	// 	]);

	// 	// for (const event of videoProducer.eventNames()) {
	// 	// 	if (typeof event !== "string") continue;
	// 	// 	videoProducer.on(event as any, (...args) => {
	// 	// 		console.debug(`videoProducer event: ${event}`, args);
	// 	// 	});
	// 	// }

	// 	videoProducer.on("trace", (trace) => {
	// 		console.debug(
	// 			`videoproducer(trace):`,
	// 			JSON.stringify(trace, null, 4),
	// 		);
	// 	});

	// 	this.client.producers.set(d.video_ssrc, videoProducer);
	// }

	let audioProducer: MediaSoupTypes.Producer | null = null;
	if (d.audio_ssrc !== 0) {
		audioProducer = await this.client.transports.producer.produce({
			kind: "audio",
			rtpParameters: {
				codecs: [
					{
						payloadType: 109,
						mimeType: "audio/opus",
						clockRate: 48000,
						channels: 2,
						rtcpFeedback: [
							{ type: "nack" },
							{ type: "transport-cc" },
						],
					},
				],
				encodings: [
					{
						ssrc: d.audio_ssrc,
					},
				],
				headerExtensions: this.client.headerExtensions,
			},
			paused: false,
		});

		console.debug(
			`audioProducer(dump)`,
			JSON.stringify(await audioProducer.dump(), null, 4),
		);

		audioProducer.enableTraceEvent([
			"fir",
			"keyframe",
			"nack",
			"pli",
			"rtp",
			"sr",
		]);

		audioProducer.on("trace", (trace) => {
			console.debug(
				`audioProducer(trace):`,
				JSON.stringify(trace, null, 4),
			);
		});

		// for (const event of audioProducer.eventNames()) {
		// 	if (typeof event !== "string") continue;
		// 	audioProducer.on(event as any, (...args) => {
		// 		console.debug(`audioproducer event: ${event}`, args);
		// 	});
		// }

		this.client.producers.set(d.audio_ssrc, audioProducer);
	}

	const clients = getClients(this.client.channel_id);
	console.log(`there are ${clients.size} clients`);
	clients.forEach(async (client) => {
		if (client.websocket.user_id === this.user_id) return;

		// if (videoProducer) {
		// 	console.debug(`consuming video for ${client.websocket.user_id}`);
		// 	const videoConsumer = await client.transports.producer.consume({
		// 		producerId: videoProducer.id,
		// 		rtpCapabilities: router.rtpCapabilities,
		// 		paused: false,
		// 	});

		// 	client.consumers.set(videoConsumer.id, videoConsumer);
		// }

		let ssrc = d.audio_ssrc;
		if (audioProducer) {
			console.debug(`consuming audio for ${client.websocket.user_id}`);
			const audioConsumer = await client.transports.producer.consume({
				producerId: audioProducer.id,
				rtpCapabilities: router.rtpCapabilities,
				paused: false,
			});
			console.log(audioConsumer as any);
			ssrc = (audioConsumer as any).consumableRtpEncodings[0].ssrc;
			console.debug(
				`audioConsumer(dump; ${client.websocket.user_id})`,
				JSON.stringify(await audioConsumer.dump(), null, 4),
			);

			client.consumers.set(audioConsumer.id, audioConsumer);
		}

		console.log(`sending video payload to ${client.websocket.user_id}`);
		Send(client.websocket, {
			op: VoiceOPCodes.VIDEO,
			d: {
				user_id: client.websocket.user_id,
				streams: d.streams!,
				audio_ssrc: ssrc,
				// video_ssrc: d.video_ssrc,
			} as VoiceVideoSchema,
		});
	});
}
