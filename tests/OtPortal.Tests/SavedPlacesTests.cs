using OtPortal.Api.Data;
using OtPortal.Api.Domain;

namespace OtPortal.Tests;

public class SavedPlacesTests
{
    // Public landmarks in Bangkok, not anyone's location.
    private static readonly SavedPlace Paragon = new() { Id = 1, PlaceId = "paragon", Lat = 13.7462, Lng = 100.5347, Name = "Paragon" };
    private static readonly SavedPlace CentralWorld = new() { Id = 2, Lat = 13.7466, Lng = 100.5393, Name = "CentralWorld" };

    [Fact]
    public void Distance_is_in_metres()
    {
        // ~500 m between the two malls
        Assert.InRange(SavedPlaces.DistanceMeters(Paragon.Lat, Paragon.Lng, CentralWorld.Lat, CentralWorld.Lng), 450, 550);
    }

    [Fact]
    public void Matches_by_place_id_even_when_far()
    {
        Assert.Same(Paragon, SavedPlaces.Match([Paragon, CentralWorld], "paragon", 0, 0));
    }

    [Fact]
    public void Matches_nearest_within_100_metres_otherwise_nothing()
    {
        Assert.Same(CentralWorld, SavedPlaces.Match([Paragon, CentralWorld], "other", 13.7470, 100.5390)); // ~55 m away
        Assert.Null(SavedPlaces.Match([Paragon, CentralWorld], "other", 13.7500, 100.5370)); // ~450 m from both
    }
}
