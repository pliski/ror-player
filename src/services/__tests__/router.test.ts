import { expect, test } from "vitest";
import { ref } from "vue";
import { useRouter } from "../router";

test("trainer route is recognized", () => {
	const path = ref("/trainer/Funk/Tune");
	const route = useRouter(path);
	expect(route.value.tab).toBe("trainer");
	if (route.value.tab === "trainer") {
		expect(route.value.tuneName).toBe("Funk");
		expect(route.value.patternName).toBe("Tune");
	}
});

test("trainer root", () => {
	const path = ref("/trainer/");
	const route = useRouter(path);
	expect(route.value.tab).toBe("trainer");
});

test("trainer tune-only (no pattern)", () => {
	const path = ref("/trainer/Funk/");
	const route = useRouter(path);
	expect(route.value.tab).toBe("trainer");
	if (route.value.tab === "trainer") {
		expect(route.value.tuneName).toBe("Funk");
		expect(route.value.patternName).toBeUndefined();
	}
});
