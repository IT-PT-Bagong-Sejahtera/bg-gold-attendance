package attendance

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestActionInputAcceptsLegacyDisplayLabels(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`{
		"type":"CLOCK_IN",
		"sectionId":"section-1",
		"evidence":{
			"employeeName":"Nama dari UI",
			"selectedLocationName":"Showroom dari UI",
			"deviceId":"device-1",
			"location":{"latitude":-6.2,"longitude":106.8,"accuracyMeters":8,"capturedAt":"2026-08-14T05:00:00Z"}
		}
	}`))
	decoder.DisallowUnknownFields()
	var input ActionInput
	if err := decoder.Decode(&input); err != nil {
		t.Fatalf("decode compatible attendance payload: %v", err)
	}
	if input.Evidence.LegacyEmployeeName != "Nama dari UI" || input.Evidence.LegacySelectedLocationName != "Showroom dari UI" {
		t.Fatalf("legacy labels were not decoded: %+v", input.Evidence)
	}
}
