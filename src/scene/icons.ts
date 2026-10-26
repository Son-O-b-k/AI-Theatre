// A curated set of Lucide icons (ISC licence) the AI may use by name.
// Imported one by one so only these end up in the bundle.

import {
  Apple, Atom, Banknote, Battery, Bell, Bird, Bone, Book, Box, Brain, Bug, Building, Calendar, Camera, Car, Cat,
  ChartColumn, ChartPie, Check, CircleAlert, Clock, Cloud, Code, Coins, Cpu, Database, Dna, Dog, DollarSign, Droplet,
  Earth, Eye, Factory, File, Fish, Flag, Flame, FlaskConical, Folder, Gauge, Globe, GraduationCap, Hammer, HardDrive,
  Heart, Home, Hospital, Image, Key, Landmark, Laptop, Layers, Leaf, Lightbulb, Lock, Magnet, Mail, MessageCircle,
  Microscope, Monitor, Moon, Mountain, Music, Network, Orbit, Package, Pill, Plane, Plug, Puzzle, RefreshCw,
  Repeat, Rocket, Router, Scale, Search, Server, Settings, Shield, ShoppingCart, Smartphone, Sprout, Star, Sun,
  Syringe, Target, Terminal, Thermometer, Timer, TreePine, TrendingDown, TrendingUp, TriangleAlert, Truck, User, Users,
  Waves, Wifi, Wind, Wrench, X, Zap,
  type IconNode,
} from 'lucide'

export const ICONS: Record<string, IconNode> = {
  apple: Apple, atom: Atom, banknote: Banknote, battery: Battery, bell: Bell, bird: Bird, bone: Bone, book: Book,
  box: Box, brain: Brain, bug: Bug, building: Building, calendar: Calendar, camera: Camera, car: Car, cat: Cat,
  'chart-bar': ChartColumn, 'chart-pie': ChartPie, check: Check, alert: CircleAlert, clock: Clock, cloud: Cloud,
  code: Code, coins: Coins, cpu: Cpu, database: Database, dna: Dna, dog: Dog, dollar: DollarSign, droplet: Droplet,
  earth: Earth, eye: Eye, factory: Factory, file: File, fish: Fish, flag: Flag, flame: Flame, flask: FlaskConical,
  folder: Folder, gauge: Gauge, globe: Globe, 'graduation-cap': GraduationCap, hammer: Hammer, disk: HardDrive,
  heart: Heart, home: Home, hospital: Hospital, image: Image, key: Key, bank: Landmark, laptop: Laptop,
  layers: Layers, leaf: Leaf, lightbulb: Lightbulb, lock: Lock, magnet: Magnet, mail: Mail, message: MessageCircle,
  microscope: Microscope, monitor: Monitor, moon: Moon, mountain: Mountain, music: Music, network: Network,
  orbit: Orbit, package: Package, pill: Pill, plane: Plane, plug: Plug, puzzle: Puzzle, refresh: RefreshCw,
  repeat: Repeat, rocket: Rocket, router: Router, scale: Scale, search: Search, server: Server, settings: Settings,
  shield: Shield, cart: ShoppingCart, phone: Smartphone, sprout: Sprout, star: Star, sun: Sun, syringe: Syringe,
  target: Target, terminal: Terminal, thermometer: Thermometer, timer: Timer, tree: TreePine,
  'trend-down': TrendingDown, 'trend-up': TrendingUp, warning: TriangleAlert, truck: Truck, user: User,
  users: Users, waves: Waves, wifi: Wifi, wind: Wind, wrench: Wrench, x: X, zap: Zap,
}

export const ICON_NAMES = Object.keys(ICONS).sort()

/** Lucide icons are drawn on a 24x24 grid. */
export const ICON_GRID = 24
