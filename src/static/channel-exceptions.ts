// url.startsWith("https://warpcast.com/~/channel/"))
// url.startsWith("https://farcaster.group/"))

// 99 known exceptions
export const exceptions = [
	{ channelId: "vip", url: "https://veryinter.net/person" },
	{ channelId: "banklessdao", url: "https://www.bankless.community" },
	{ channelId: "nouns-esports", url: "https://nouns.gg" },
	{ channelId: "cocreated", url: "https://app.cocreated.xyz" },
	{
		channelId: "based-management",
		url: "https://www.based.management",
	},
	{ channelId: "bounties", url: "https://www.bountycaster.xyz" },
	{ channelId: "drawtech", url: "https://www.draw.tech" },
	{ channelId: "mintdotfun", url: "https://mint.fun" },
	{ channelId: "superrare", url: "https://superrare.com" },
	{ channelId: "party", url: "https://www.party.app" },
	{ channelId: "uniswap", url: "https://uniswap.org" },
	{ channelId: "rarible", url: "https://rarible.com" },
	{ channelId: "obsidian", url: "https://obsidian.md" },
	{ channelId: "foundation", url: "https://foundation.app" },
	{ channelId: "rainbow", url: "https://rainbow.me" },
	{ channelId: "pool-together", url: "https://pooltogether.com" },
	{ channelId: "ens", url: "https://ens.domains" },
	{ channelId: "basepaint", url: "https://basepaint.xyz" },
	{ channelId: "eth-staker", url: "https://ethstaker.cc" },
	{ channelId: "viem", url: "https://viem.sh" },
	{ channelId: "paragraph", url: "https://paragraph.xyz" },
	{ channelId: "gitcoin", url: "https://www.gitcoin.co" },
	{
		channelId: "classical",
		url: "https://en.wikipedia.org/wiki/Johann_Sebastian_Bach",
	},
	{
		channelId: "gen-art",
		url: "chain://eip155:8453/erc721:0xe7a43b5942f15fddeb9733fdcc57c6232f1d5aa0",
	},
	{
		channelId: "opepen",
		url: "chain://eip155:1/erc721:0x6339e5e072086621540d0362c4e3cea0d643e114",
	},
	{
		channelId: "farcats",
		url: "chain://eip155:1/erc721:0x9340204616750cb61e56437befc95172c6ff6606",
	},
	{
		channelId: "lil-nouns",
		url: "chain://eip155:1/erc721:0x4b10701bfd7bfedc47d50562b76b436fbb5bdb3b",
	},
	{
		channelId: "milady",
		url: "chain://eip155:1/erc721:0x5af0d9827e0c53e4799bb226655a1de152a425a5",
	},
	{
		channelId: "checks",
		url: "chain://eip155:1/erc721:0x34eebee6942d8def3c125458d1a86e0a897fd6f9",
	},
	{
		channelId: "gnars",
		url: "chain://eip155:1/erc721:0x558bfff0d583416f7c4e380625c7865821b8e95c",
	},
	{ channelId: "curta", url: "https://www.curta.wtf" },
	{
		channelId: "farcasther",
		url: "chain://eip155:8453/erc721:0x1e5115dc60cdab3c1263a945201cb509ea7a8340",
	},
	{ channelId: "cricket", url: "https://www.cricketworldcup.com" },
	{ channelId: "bright-moments", url: "https://www.brightmoments.io" },
	{ channelId: "devconnect", url: "https://devconnect.org" },
	{ channelId: "apple", url: "https://www.apple.com" },
	{ channelId: "rugby", url: "https://www.rugbyworldcup.com" },
	{
		channelId: "nature",
		url: "chain://eip155:7777777/erc721:0xf6a7d848603aff875e4f35025e5c568679ccc17c",
	},
	{
		channelId: "parenting",
		url: "chain://eip155:8453/erc721:0xb7310fc4b4a31c4fb7adf90b8201546bb2bcb52c",
	},
	{
		channelId: "science",
		url: "chain://eip155:8453/erc721:0xd953664a9b9e30fa7b3ccd00a2f9c21c7b75c5f0",
	},
	{ channelId: "rust", url: "https://www.rust-lang.org" },
	{
		channelId: "rust-x-ethereum",
		url: "chain://eip155:7777777/erc721:0x3312a43f15a9a9a1c6b7ee055e4b71041c2613e6",
	},
	{ channelId: "network-states", url: "https://thenetworkstate.com" },
	{ channelId: "base", url: "https://onchainsummer.xyz" },
	{
		channelId: "jobs",
		url: "chain://eip155:8453/erc721:0x5fcd7a54fdf08c8dbcb969bc1f021ae87affafa8",
	},
	{ channelId: "nfl", url: "https://www.nfl.com" },
	{
		channelId: "gm",
		url: "chain://eip155:7777777/erc721:0x5556efe18d87f132054fbd4ba9afc13ebb1b0594",
	},
	{
		channelId: "gaming",
		url: "chain://eip155:7777777/erc721:0xa390bc5b492f4d378ca2ef513a45a89d54538f02",
	},
	{
		channelId: "dogs",
		url: "chain://eip155:7777777/erc721:0x8cb43a65b27461b61d6c8989e6f9d88e5426833d",
	},
	{ channelId: "quilibrium", url: "https://www.quilibrium.com" },
	{ channelId: "tezos", url: "https://tezos.com" },
	{
		channelId: "history",
		url: "chain://eip155:7777777/erc721:0x177aa0bf214af03499c1fe239de20f3c4c373250",
	},
	{
		channelId: "farquest",
		url: "chain://eip155:1/erc721:0x427b8efee2d6453bb1c59849f164c867e4b2b376",
	},
	{
		channelId: "cats",
		url: "chain://eip155:7777777/erc721:0x038adac316a87c29c3acc8641e1d8320bb0144c2",
	},
	{
		channelId: "ponder",
		url: "chain://eip155:1/erc721:0xb58f8b1972c86aacd58f86ffae37ed31664c934d",
	},
	{
		channelId: "welcome",
		url: "chain://eip155:7777777/erc721:0x8f0055447ffae257e9025b781643127ca604baaa",
	},
	{
		channelId: "farcaster",
		url: "chain://eip155:7777777/erc721:0x4f86113fc3e9783cf3ec9a552cbb566716a57628",
	},
	{ channelId: "bitcoin", url: "https://bitcoin.org" },
	{ channelId: "ethereum", url: "https://ethereum.org" },
	{
		channelId: "zk",
		url: "chain://eip155:7777777/erc721:0xec30bb189781bbd87478f625d19d9deeeb771964",
	},
	{
		channelId: "frontend",
		url: "chain://eip155:7777777/erc721:0x3d037b11c5359fac54c3928dfad0b9512695d392",
	},
	{
		channelId: "backend",
		url: "chain://eip155:7777777/erc721:0x9d9f2365dc761dbcdc9af8120472c5e88c90833c",
	},
	{
		channelId: "fashion",
		url: "chain://eip155:7777777/erc721:0x73a2bba481d2b4ec00ecbce45f580aabad14ae26",
	},
	{
		channelId: "f1",
		url: "chain://eip155:7777777/erc721:0x47163feb5c3b97f90671b1e1a1359b8240edbdbe",
	},
	{
		channelId: "warpcast",
		url: "chain://eip155:7777777/erc721:0x10a77f29a6bbeae936f3f27cd60546072dae4e41",
	},
	{
		channelId: "degen",
		url: "chain://eip155:7777777/erc721:0x5d6a07d07354f8793d1ca06280c4adf04767ad7e",
	},
	{
		channelId: "photography",
		url: "chain://eip155:7777777/erc721:0x36ef4ed7a949ee87d5d2983f634ae87e304a9ea2",
	},
	{ channelId: "nba", url: "https://www.nba.com" },
	{
		channelId: "manga-anime",
		url: "chain://eip155:7777777/erc721:0x5a5ddb8a2d1ee3d8e9fd59785da88d573d1a84fe",
	},
	{ channelId: "solana", url: "https://solana.com" },
	{
		channelId: "news",
		url: "chain://eip155:7777777/erc721:0x3cf3d6a6bcac3c60f3bb59fdd641b042102bb488",
	},
	{
		channelId: "travel",
		url: "chain://eip155:7777777/erc721:0x917ef0a90d63030e6aa37d51d7e6ece440ace537",
	},
	{
		channelId: "design",
		url: "chain://eip155:7777777/erc721:0x22be981fb87effbe6780b34a6fe1dfc14a00ec8e",
	},
	{
		channelId: "space",
		url: "chain://eip155:7777777/erc721:0x31fa484c7df6e0f04f520c97a7552d72123c1bc1",
	},
	{ channelId: "midjourney", url: "https://midjourney.com" },
	{
		channelId: "tabletop",
		url: "chain://eip155:7777777/erc721:0xf7ebaea271e84a0c40e90bc6f5889dbfa0a12366",
	},
	{
		channelId: "philosophy",
		url: "chain://eip155:7777777/erc721:0xc48c325f794f9105000aa27d427fbed363fa7112",
	},
	{
		channelId: "sf",
		url: "chain://eip155:7777777/erc721:0x2df74b933d530c66679e6fcc4c9396ebb230ccb2",
	},
	{ channelId: "op-stack", url: "https://www.optimism.io" },
	{
		channelId: "art",
		url: "chain://eip155:1/erc721:0x1538c5ddbb073638b7cd1ae41ec2d9f9a4c24a7e",
	},
	{
		channelId: "neynar",
		url: "chain://eip155:1/erc721:0xd4498134211baad5846ce70ce04e7c4da78931cc",
	},
	{
		channelId: "ai",
		url: "chain://eip155:7777777/erc721:0x5747eef366fd36684e8893bf4fe628efc2ac2d10",
	},
	{
		channelId: "chess",
		url: "chain://eip155:7777777/erc721:0xca3e25b5c41b02ffa6f3b053426e96b59b64a9ae",
	},
	{
		channelId: "music",
		url: "chain://eip155:7777777/erc721:0xe96c21b136a477a6a97332694f0caae9fbb05634",
	},
	{
		channelId: "eff-acc",
		url: "chain://eip155:7777777/erc721:0xc2a1570703480b72091283decb80292c273db559",
	},
	{
		channelId: "new-york",
		url: "chain://eip155:1/erc721:0xfdd5e7949bd72c95907c46a630d2c791f0e842c6",
	},
	{
		channelId: "event-pass",
		url: "chain://eip155:1/erc721:0x7ea3dff0fcd9a203f594c7474f7c6bd098af0427",
	},
	{ channelId: "cabin-city", url: "https://cabin.city" },
	{
		channelId: "electronic",
		url: "chain://eip155:1/erc721:0x05acde54e82e7e38ec12c5b5b4b1fd1c8d32658d",
	},
	{ channelId: "orange-dao", url: "https://www.orangedao.xyz" },
	{
		channelId: "zora",
		url: "chain://eip155:1/erc721:0xca21d4228cdcc68d4e23807e5e370c07577dd152",
	},
	{ channelId: "sbc", url: "https://cbr.stanford.edu/sbc23/" },
	{
		channelId: "screens",
		url: "chain://eip155:1/erc721:0xc4934dbb7a71f76e4068cd04fade20ad6c0023dd",
	},
	{
		channelId: "football",
		url: "chain://eip155:1/erc721:0x7abfe142031532e1ad0e46f971cc0ef7cf4b98b0",
	},
	{
		channelId: "unlonely",
		url: "chain://eip155:1/erc721:0xc7e230ce8d67b2ad116208c69d616dd6bfc96a8d",
	},
	{
		channelId: "ethg-ny",
		url: "https://ethglobal.com/events/newyork2023",
	},
	{
		channelId: "fitness",
		url: "chain://eip155:1/erc721:0xee442da02f2cdcbc0140162490a068c1da94b929",
	},
	{ channelId: "fwb-fest", url: "https://fest.fwb.help" },
	{
		channelId: "memes",
		url: "chain://eip155:1/erc721:0xfd8427165df67df6d7fd689ae67c8ebf56d9ca61",
	},
];
