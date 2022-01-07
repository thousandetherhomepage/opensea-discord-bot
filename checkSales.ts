import 'dotenv/config';
import Discord, { TextChannel, Message } from 'discord.js';
import fetch from 'node-fetch';
import { ethers } from "ethers";

const OPENSEA_SHARED_STOREFRONT_ADDRESS = '0x495f947276749Ce646f68AC8c248420045cb7b5e';

const discordBot = new Discord.Client();

class MockChannel {
  send(message) {
    console.log(message);
  }
}

const discordSetup = async (): Promise<TextChannel | MockChannel> => {

  return new Promise<TextChannel | MockChannel>((resolve, _reject) => {
    if (!process.env['DISCORD_BOT_TOKEN'] || !process.env['DISCORD_CHANNEL_ID']) {
      console.warn(`Discord API keys not set. Logging instead`)
      return resolve(new MockChannel());
    }

    discordBot.login(process.env.DISCORD_BOT_TOKEN);
    discordBot.on('ready', async () => {
      const channel = await discordBot.channels.fetch(process.env.DISCORD_CHANNEL_ID!);
      resolve(channel as TextChannel);
    });
  })
}

const buildMessage = (sale: any) => (
  new Discord.MessageEmbed()
    .setColor('#0099ff')
    .setTitle(sale.asset.name + ' sold!')
    .setURL(sale.asset.permalink)
    .setAuthor('OpenSea Bot', 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png', 'https://github.com/sbauch/opensea-discord-bot')
    .setThumbnail(sale.asset.collection.image_url)
    .addFields(
      { name: 'Name', value: sale.asset.name },
      { name: 'Amount', value: `${ethers.utils.formatEther(sale.total_price || '0')}${ethers.constants.EtherSymbol}` },
      { name: 'Buyer', value: sale?.winner_account?.address, },
      { name: 'Seller', value: sale?.seller?.address, },
    )
    .setImage(sale.asset.image_url)
    .setTimestamp(Date.parse(`${sale?.created_date}Z`))
    .setFooter('Sold on OpenSea', 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png')
)

const sortitionAddress = "0xa9a57f7d2A54C1E172a7dC546fEE6e03afdD28E2";
const sortitionABI = [
  "event Nominated(uint256 indexed termNumber, address nominator, uint256 pixels)",
  "function nominatedTokens(uint256) view returns (uint256)",
  "function termExpires() view returns (uint256)",
  "function getNominatedToken(uint256) view returns (uint256)",
  "function getAdPixels(uint256) view returns (uint256)",
];

async function sortitionLog(hoursAgo: number) {
  const sinceBlockLowerbound = hoursAgo * 60 * 6; // ETH blocks are mined every 12-16s, so let's do 60/10 = 6 as an upper bound we'll discard excess events.
  const sinceTimestamp = Math.floor((+new Date()) / 1000) - (hoursAgo * 60 * 60);

  const provider = new ethers.providers.JsonRpcProvider("https://rpc.flashbots.net");


  const sortitionContract = new ethers.Contract(sortitionAddress, sortitionABI, provider);

  console.log("Current term expires on", new Date((await sortitionContract.termExpires()).toNumber()*1000));

  const filter = sortitionContract.filters.Nominated();
  const events = await sortitionContract.queryFilter(filter, -sinceBlockLowerbound, "latest")

  console.debug("Found", events.length, "events in the last", sinceBlockLowerbound, "blocks");

  // Discard events until we find ones that are within our time window
  while (events.length > 0) {
    const b = await events[0].getBlock();
    if (b.timestamp >= sinceTimestamp) break;

    console.debug("Discarding event", b.timestamp, events[0]);
    events.shift();
  };

  for (const evt of events) {
    console.log("Address", evt.args.nominator, "nominated", evt.args.pixels.toString(), "pixels for term", evt.args.termNumber.toString());
  }

  // FIXME: Below is not tested at all

  // Loop over nominations and tally
  const nominations = {};
  for (let i=0;;i++) {
    try {
      const n = await sortitionContract.nominatedTokens(0);
      nominations[n.toString()] = 0;
    } catch(err) {
      break
    }
  }

  for (const tokenId in nominations) {
    console.debug("tokenId", tokenId);
    const nominatedTokenId = await sortitionContract.getNominatedToken(tokenId);
    const pixels = await sortitionContract.getAdPixels(tokenId.toString());
    console.log(tokenId, "nominated", nominatedTokenId.toString(), "for", pixels.toString(), "pixels");
    // TODO: Accumulate these indexed by nominatedTokenId before printing? Or do we prefer a stream?
  }

  // TODO: Build somekind of datastructure with all of the above to return into a formatted discord thing?
}

async function main() {
  const channel = await discordSetup();
  const seconds = process.env.SECONDS ? parseInt(process.env.SECONDS) : 3_600;
  const hoursAgo = (Math.floor(new Date().getTime() / 1000) - (seconds)); // in the last hour, run hourly?

  //await sortitionLog(hoursAgo);
  await sortitionLog(24 * 7 * 6 * 1); // 1 elections ago
  throw "XXX: Debugging"

  const params = new URLSearchParams({
    offset: '0',
    event_type: 'successful',
    only_opensea: 'false',
    occurred_after: hoursAgo.toString(),
    collection_slug: process.env.COLLECTION_SLUG!,
  })

  if (process.env.CONTRACT_ADDRESS !== OPENSEA_SHARED_STOREFRONT_ADDRESS) {
    params.append('asset_contract_address', process.env.CONTRACT_ADDRESS!)
  }

  let opts = {};
  console.log(process.env.OPENSEA_API_TOKEN)
  if (process.env.OPENSEA_API_TOKEN) {
    opts["headers"] = { "X-API-KEY": process.env.OPENSEA_API_TOKEN }
  }

  const openSeaResponse = await fetch(
    "https://api.opensea.io/api/v1/events?" + params, opts).then((resp) => resp.json());

  return await Promise.all(
    openSeaResponse?.asset_events?.reverse().map(async (sale: any) => {
      const message = buildMessage(sale);
      return channel.send(message)
    })
  );
}

main()
  .then((res) => {
    if (!res.length) console.log("No recent sales")
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
