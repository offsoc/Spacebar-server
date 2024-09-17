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

	if (d.audio_ssrc === 0 && d.video_ssrc === 0) return;

	const router = getRouter(channel_id);
	if (!router) {
		console.error(`router not found`);
		return;
	}

	const transport = this.client.transport!;

	let audioProducer: MediaSoupTypes.Producer | undefined =
		this.client.producers.audio;

	if (d.audio_ssrc !== 0) {
		if (!audioProducer) {
			audioProducer = await transport.produce({
				kind: "audio",
				rtpParameters: {
					codecs: [
						{
							payloadType: 111,
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
							maxBitrate: 64000,
						},
					],
					headerExtensions: [
						{
							id: 1,
							uri: "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
						},
					],
					// headerExtensions: this.client
					// 	.sdpOffer2!.media[0].ext?.filter((x) =>
					// 		SUPPORTED_EXTENTIONS.includes(x.uri),
					// 	)
					// 	.map((x) => ({
					// 		uri: x.uri as NMediaSoupTypes.RtpHeaderExtensionUri,
					// 		id: x.value,
					// 		encrypt: false,
					// 	})),
				},
			});

			await audioProducer.enableTraceEvent(["rtp"]);

			audioProducer.on("score", (score) => {
				console.debug(`audio producer score:`, score);
			});
			this.client.producers.audio = audioProducer;
		}
	}

	let videoProducer: MediaSoupTypes.Producer | undefined =
		this.client.producers.video;

	if (d.video_ssrc !== 0) {
		videoProducer = await transport.produce({
			kind: "video",
			rtpParameters: {
				codecs: [
					{
						payloadType: 102,
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
				],
				encodings: [
					{
						ssrc: d.video_ssrc,
						rtx: { ssrc: d.rtx_ssrc! },
						scalabilityMode: "L1T1",
					},
				],
				// headerExtensions: this.client
				// 	.sdpOffer2!.media[1].ext?.filter((x) =>
				// 		SUPPORTED_EXTENTIONS.includes(x.uri),
				// 	)
				// 	.map((x) => ({
				// 		uri: x.uri as NMediaSoupTypes.RtpHeaderExtensionUri,
				// 		id: x.value,
				// 		encrypt: false,
				// 	})),
			},
		});

		await videoProducer.enableTraceEvent(["rtp"]);

		videoProducer.on("score", (score) => {
			console.debug(`video producer score:`, score);
		});
	}

	// loop the clients and add a consumer for each one
	const clients = getClients(channel_id);
	for (const client of clients) {
		if (client.websocket.user_id === this.user_id) continue;
		if (!client.transport) continue;

		if (d.audio_ssrc !== 0) {
			// close the existing consumer if it exists
			const a = client.consumers.filter((x) => x.kind === "audio");
			await a.forEach(async (x) => await x.close());
			const consumer = await client.transport.consume({
				producerId: audioProducer?.id!,
				rtpCapabilities: router.router.rtpCapabilities,
				paused: false,
			});
			client.consumers.push(consumer);
		}

		if (d.video_ssrc !== 0) {
			// close the existing consumer if it exists
			const a = client.consumers.filter((x) => x.kind === "video");
			await a.forEach(async (x) => await x.close());
			const consumer = await client.transport.consume({
				producerId: videoProducer?.id!,
				rtpCapabilities: router.router.rtpCapabilities,
				paused: false,
			});
			client.consumers.push(consumer);
		}

		Send(client.websocket, {
			op: VoiceOPCodes.VIDEO,
			d: {
				user_id: this.user_id,
				audio_ssrc: d.audio_ssrc || 0,
				video_ssrc: d.video_ssrc || 0,
				streams: d.streams?.map((x) => ({
					...x,
					active: true,
				})),
			},
		});
	}
}
