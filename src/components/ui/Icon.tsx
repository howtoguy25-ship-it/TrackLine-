import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import AmbulanceIcon from "lucide-react-native/icons/ambulance";
import ArrowLeftIcon from "lucide-react-native/icons/arrow-left";
import ArrowUpIcon from "lucide-react-native/icons/arrow-up";
import ArrowUpDownIcon from "lucide-react-native/icons/arrow-up-down";
import ArrowUpLeftIcon from "lucide-react-native/icons/arrow-up-left";
import ArrowUpRightIcon from "lucide-react-native/icons/arrow-up-right";
import BadgeCheckIcon from "lucide-react-native/icons/badge-check";
import BedIcon from "lucide-react-native/icons/bed";
import BellIcon from "lucide-react-native/icons/bell";
import BikeIcon from "lucide-react-native/icons/bike";
import BluetoothIcon from "lucide-react-native/icons/bluetooth";
import BookmarkIcon from "lucide-react-native/icons/bookmark";
import BriefcaseIcon from "lucide-react-native/icons/briefcase";
import BriefcaseMedicalIcon from "lucide-react-native/icons/briefcase-medical";
import Building2Icon from "lucide-react-native/icons/building-2";
import BusIcon from "lucide-react-native/icons/bus";
import CalendarIcon from "lucide-react-native/icons/calendar";
import CameraIcon from "lucide-react-native/icons/camera";
import CarIcon from "lucide-react-native/icons/car";
import CarFrontIcon from "lucide-react-native/icons/car-front";
import CctvIcon from "lucide-react-native/icons/cctv";
import CheckIcon from "lucide-react-native/icons/check";
import ChevronDownIcon from "lucide-react-native/icons/chevron-down";
import ChevronLeftIcon from "lucide-react-native/icons/chevron-left";
import ChevronRightIcon from "lucide-react-native/icons/chevron-right";
import ChevronUpIcon from "lucide-react-native/icons/chevron-up";
import CircleIcon from "lucide-react-native/icons/circle";
import CircleAlertIcon from "lucide-react-native/icons/circle-alert";
import CircleCheckIcon from "lucide-react-native/icons/circle-check";
import CircleDotIcon from "lucide-react-native/icons/circle-dot";
import CircleHelpIcon from "lucide-react-native/icons/circle-help";
import CirclePlusIcon from "lucide-react-native/icons/circle-plus";
import CircleUserIcon from "lucide-react-native/icons/circle-user";
import CircleXIcon from "lucide-react-native/icons/circle-x";
import ClockIcon from "lucide-react-native/icons/clock";
import CloudOffIcon from "lucide-react-native/icons/cloud-off";
import CodeIcon from "lucide-react-native/icons/code";
import CompassIcon from "lucide-react-native/icons/compass";
import ConstructionIcon from "lucide-react-native/icons/construction";
import CopyIcon from "lucide-react-native/icons/copy";
import CornerUpLeftIcon from "lucide-react-native/icons/corner-up-left";
import CornerUpRightIcon from "lucide-react-native/icons/corner-up-right";
import CpuIcon from "lucide-react-native/icons/cpu";
import DollarSignIcon from "lucide-react-native/icons/dollar-sign";
import DropletsIcon from "lucide-react-native/icons/droplets";
import EarthIcon from "lucide-react-native/icons/earth";
import EllipsisIcon from "lucide-react-native/icons/ellipsis";
import EllipsisVerticalIcon from "lucide-react-native/icons/ellipsis-vertical";
import ExternalLinkIcon from "lucide-react-native/icons/external-link";
import EyeIcon from "lucide-react-native/icons/eye";
import EyeOffIcon from "lucide-react-native/icons/eye-off";
import FileBadgeIcon from "lucide-react-native/icons/file-badge";
import FlagIcon from "lucide-react-native/icons/flag";
import FlameIcon from "lucide-react-native/icons/flame";
import FootprintsIcon from "lucide-react-native/icons/footprints";
import FuelIcon from "lucide-react-native/icons/fuel";
import GlobeIcon from "lucide-react-native/icons/globe";
import HandIcon from "lucide-react-native/icons/hand";
import HeadphonesIcon from "lucide-react-native/icons/headphones";
import HouseIcon from "lucide-react-native/icons/house";
import ImageIcon from "lucide-react-native/icons/image";
import InfoIcon from "lucide-react-native/icons/info";
import KeyRoundIcon from "lucide-react-native/icons/key-round";
import LayersIcon from "lucide-react-native/icons/layers";
import LayoutDashboardIcon from "lucide-react-native/icons/layout-dashboard";
import LeafIcon from "lucide-react-native/icons/leaf";
import LocateFixedIcon from "lucide-react-native/icons/locate-fixed";
import LockIcon from "lucide-react-native/icons/lock";
import MailIcon from "lucide-react-native/icons/mail";
import MapIcon from "lucide-react-native/icons/map";
import MapPinIcon from "lucide-react-native/icons/map-pin";
import MapPinOffIcon from "lucide-react-native/icons/map-pin-off";
import MenuIcon from "lucide-react-native/icons/menu";
import MergeIcon from "lucide-react-native/icons/merge";
import MicIcon from "lucide-react-native/icons/mic";
import MoonIcon from "lucide-react-native/icons/moon";
import MusicIcon from "lucide-react-native/icons/music";
import NavigationIcon from "lucide-react-native/icons/navigation";
import PaletteIcon from "lucide-react-native/icons/palette";
import PencilIcon from "lucide-react-native/icons/pencil";
import PhoneIcon from "lucide-react-native/icons/phone";
import PlaneIcon from "lucide-react-native/icons/plane";
import PlayIcon from "lucide-react-native/icons/play";
import PlusIcon from "lucide-react-native/icons/plus";
import RadioIcon from "lucide-react-native/icons/radio";
import Redo2Icon from "lucide-react-native/icons/redo-2";
import RefreshCwIcon from "lucide-react-native/icons/refresh-cw";
import RotateCcwIcon from "lucide-react-native/icons/rotate-ccw";
import RotateCwIcon from "lucide-react-native/icons/rotate-cw";
import ScanSearchIcon from "lucide-react-native/icons/scan-search";
import SchoolIcon from "lucide-react-native/icons/school";
import SearchIcon from "lucide-react-native/icons/search";
import SendIcon from "lucide-react-native/icons/send";
import SettingsIcon from "lucide-react-native/icons/settings";
import Share2Icon from "lucide-react-native/icons/share-2";
import ShoppingCartIcon from "lucide-react-native/icons/shopping-cart";
import SlidersHorizontalIcon from "lucide-react-native/icons/sliders-horizontal";
import SmartphoneIcon from "lucide-react-native/icons/smartphone";
import SmileIcon from "lucide-react-native/icons/smile";
import SplitIcon from "lucide-react-native/icons/split";
import SquareIcon from "lucide-react-native/icons/square";
import SquareCheckIcon from "lucide-react-native/icons/square-check";
import SquareParkingIcon from "lucide-react-native/icons/square-parking";
import StarIcon from "lucide-react-native/icons/star";
import TrainFrontIcon from "lucide-react-native/icons/train-front";
import Trash2Icon from "lucide-react-native/icons/trash-2";
import TriangleAlertIcon from "lucide-react-native/icons/triangle-alert";
import TvIcon from "lucide-react-native/icons/tv";
import Undo2Icon from "lucide-react-native/icons/undo-2";
import UserIcon from "lucide-react-native/icons/user";
import UserPlusIcon from "lucide-react-native/icons/user-plus";
import UsersIcon from "lucide-react-native/icons/users";
import UtensilsIcon from "lucide-react-native/icons/utensils";
import VideoIcon from "lucide-react-native/icons/video";
import Volume1Icon from "lucide-react-native/icons/volume-1";
import Volume2Icon from "lucide-react-native/icons/volume-2";
import VolumeXIcon from "lucide-react-native/icons/volume-x";
import XIcon from "lucide-react-native/icons/x";
import ZapIcon from "lucide-react-native/icons/zap";
import CirclePauseIcon from "lucide-react-native/icons/circle-pause";
import CirclePlayIcon from "lucide-react-native/icons/circle-play";
import DownloadIcon from "lucide-react-native/icons/download";
import BatteryWarningIcon from "lucide-react-native/icons/battery-warning";
import BatteryFullIcon from "lucide-react-native/icons/battery-full";

// The app's one icon set: Lucide's line icons (ISC licence), drawn at a 1.75 stroke and 24pt
// unless a smaller inline size is asked for. Screens name icons the way they always have
// ("close", "chevron-forward", "navigate-outline"...); "-outline" is accepted and means the same
// line icon, since every icon here IS a line icon. `filled` fills the shape for an "on" state
// (a saved bookmark, a chosen star).
//
// Map artwork -- report pins, the user-chosen alert icon themes, the car arrow -- is not UI
// iconography and keeps its own drawings (map-v2/layers/MapIcons.tsx, AlertTypeGlyph.tsx).

export const ICON_STROKE = 1.75;
export const ICON_SIZE = 24;

const ICONS = {
  "battery-heart-variant": BatteryFullIcon,
  "battery-alert": BatteryWarningIcon,
  "download": DownloadIcon,
  "play-circle": CirclePlayIcon,
  "pause-circle": CirclePauseIcon,
  "add": PlusIcon,
  "add-circle": CirclePlusIcon,
  "airplane": PlaneIcon,
  "alert-circle": CircleAlertIcon,
  "ambulance": AmbulanceIcon,
  "arrow-back": ArrowLeftIcon,
  "arrow-undo": Undo2Icon,
  "bed": BedIcon,
  "bicycle": BikeIcon,
  "bluetooth": BluetoothIcon,
  "bookmark": BookmarkIcon,
  "briefcase": BriefcaseIcon,
  "bus": BusIcon,
  "business": Building2Icon,
  "call": PhoneIcon,
  "calendar": CalendarIcon,
  "camera": CameraIcon,
  "car": CarIcon,
  "car-crash": CarFrontIcon,
  "car-info": CarFrontIcon,
  "car-search": ScanSearchIcon,
  "car-sport": CarIcon,
  "cart": ShoppingCartIcon,
  "cctv": CctvIcon,
  "cellphone": SmartphoneIcon,
  "check-circle": CircleCheckIcon,
  "check-decagram": BadgeCheckIcon,
  "checkbox": SquareCheckIcon,
  "checkmark": CheckIcon,
  "checkmark-circle": CircleCheckIcon,
  "chevron-back": ChevronLeftIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-forward": ChevronRightIcon,
  "chevron-right": ChevronRightIcon,
  "chevron-up": ChevronUpIcon,
  "close": XIcon,
  "close-circle": CircleXIcon,
  "cloud-offline": CloudOffIcon,
  "code-slash": CodeIcon,
  "color-palette": PaletteIcon,
  "compass": CompassIcon,
  "construct": ConstructionIcon,
  "copy": CopyIcon,
  "currency-usd": DollarSignIcon,
  "earth": EarthIcon,
  "ellipse": CircleIcon,
  "ellipsis-horizontal": EllipsisIcon,
  "ellipsis-vertical": EllipsisVerticalIcon,
  "eye": EyeIcon,
  "eye-off": EyeOffIcon,
  "file-certificate": FileBadgeIcon,
  "flag": FlagIcon,
  "flame": FlameIcon,
  "flash": ZapIcon,
  "fork-left": SplitIcon,
  "fork-right": SplitIcon,
  "gas-station": FuelIcon,
  "globe": GlobeIcon,
  "hand-left": HandIcon,
  "happy": SmileIcon,
  "hardware-chip": CpuIcon,
  "headset": HeadphonesIcon,
  "help-circle": CircleHelpIcon,
  "home": HouseIcon,
  "image": ImageIcon,
  "information": InfoIcon,
  "information-circle": InfoIcon,
  "key-variant": KeyRoundIcon,
  "layers": LayersIcon,
  "leaf": LeafIcon,
  "locate": LocateFixedIcon,
  "location": MapPinIcon,
  "lock": LockIcon,
  "lock-closed": LockIcon,
  "mail": MailIcon,
  "map": MapIcon,
  "map-marker-off": MapPinOffIcon,
  "medkit": BriefcaseMedicalIcon,
  "menu": MenuIcon,
  "merge": MergeIcon,
  "mic": MicIcon,
  "moon": MoonIcon,
  "musical-notes": MusicIcon,
  "navigate": NavigationIcon,
  "notifications": BellIcon,
  "open": ExternalLinkIcon,
  "options": SlidersHorizontalIcon,
  "parking": SquareParkingIcon,
  "pencil": PencilIcon,
  "people": UsersIcon,
  "person": UserIcon,
  "person-add": UserPlusIcon,
  "person-circle": CircleUserIcon,
  "play": PlayIcon,
  "radio": RadioIcon,
  "radio-button-on": CircleDotIcon,
  "ramp-left": ArrowUpLeftIcon,
  "ramp-right": ArrowUpRightIcon,
  "refresh": RefreshCwIcon,
  "restaurant": UtensilsIcon,
  "return-up-back": CornerUpLeftIcon,
  "roundabout-left": RotateCcwIcon,
  "roundabout-right": RotateCwIcon,
  "school": SchoolIcon,
  "search": SearchIcon,
  "send": SendIcon,
  "settings": SettingsIcon,
  "share": Share2Icon,
  "square": SquareIcon,
  "star": StarIcon,
  "stop": SquareIcon,
  "straight": ArrowUpIcon,
  "swap-vertical": ArrowUpDownIcon,
  "sync": RefreshCwIcon,
  "time": ClockIcon,
  "train": TrainFrontIcon,
  "trash": Trash2Icon,
  "turn-left": CornerUpLeftIcon,
  "turn-right": CornerUpRightIcon,
  "turn-sharp-left": CornerUpLeftIcon,
  "turn-sharp-right": CornerUpRightIcon,
  "turn-slight-left": ArrowUpLeftIcon,
  "turn-slight-right": ArrowUpRightIcon,
  "tv": TvIcon,
  "u-turn-left": Undo2Icon,
  "u-turn-right": Redo2Icon,
  "videocam": VideoIcon,
  "view-dashboard": LayoutDashboardIcon,
  "volume-high": Volume2Icon,
  "volume-low": Volume1Icon,
  "volume-medium": Volume1Icon,
  "volume-mute": VolumeXIcon,
  "walk": FootprintsIcon,
  "warning": TriangleAlertIcon,
  "water": DropletsIcon,
} satisfies Record<string, LucideIcon>;

type BaseIconName = keyof typeof ICONS;
export type IconName = BaseIconName | `${BaseIconName}-outline`;

export function iconComponent(name: IconName): LucideIcon {
  const base = (name.endsWith("-outline") ? name.slice(0, -"-outline".length) : name) as BaseIconName;
  return ICONS[base];
}

export function isIconName(name: string): name is IconName {
  const base = name.endsWith("-outline") ? name.slice(0, -"-outline".length) : name;
  return base in ICONS;
}

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  /** Fill the shape (an "on" state). */
  filled?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Icon({ name, size = ICON_SIZE, color = "#1F2125", filled = false, strokeWidth = ICON_STROKE, style, testID }: Props) {
  // The glyph is looked up from a fixed table (never created here), so createElement with it is
  // the same as writing <XIcon .../> for that icon.
  return React.createElement(iconComponent(name), {
    size,
    color,
    strokeWidth,
    fill: filled ? color : "none",
    style,
    testID,
    accessible: false,
  });
}
