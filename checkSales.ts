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
  "function nominatedTokens() view returns (uint256[])",
];

async function sortitionLog() {
  const provider = new ethers.providers.JsonRpcProvider("https://rpc.flashbots.net");
  //const signer = provider.getSigner()
  console.log(await provider.getBlockNumber())

  const sortitionContract = new ethers.Contract(sortitionAddress, sortitionABI, provider);
  //const filter = sortitionContract.filters.Nominated();
  //console.log(await sortitionContract.queryFilter(filter));

  const nominations = await sortitionContract.nominatedTokens();
  console.log(nominations);
}

async function main() {
  await sortitionLog()
  return ""
  const channel = await discordSetup();
  const seconds = process.env.SECONDS ? parseInt(process.env.SECONDS) : 3_600;
  const hoursAgo = (Math.round(new Date().getTime() / 1000) - (seconds)); // in the last hour, run hourly?

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
